"""Camada analítica de treino -> public.training_load.

Calcula (todo o cálculo aqui, nunca no frontend):
  TSS por dia     — oficial do Suunto (activities.tss) ou TRIMP de Banister
                    para o arquivo Garmin: TRIMP = min × HFr × 0.64 × e^(1.92×HFr)
  CTL (42d) / ATL (7d) — médias móveis exponenciais; TSB = CTL − ATL
  ACR             — rácio agudo:crónico (média 7d / média 28d)
  Banda HRV       — baseline 60 dias (min/média/máx) por dia
  Readiness 0-100 — sono + HRV + TSB + carga aguda (pesos iguais, config)
  Predições       — Riegel a partir dos PRs oficiais, ajustado pelo VO2máx:
                    t(D) = PR(D) × (vo2_pr / vo2_hoje)^1.06

Popula TODO o histórico (2019 → hoje) e é chamado pelo suunto_sync a cada ciclo.
Uso: .venv/bin/python scripts/training_load_sync.py [--days N]
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")

# ---------------- config ----------------
HR_MAX = float(os.getenv("TRAINING_HR_MAX", "184"))       # userMaxHR do Suunto
HR_REST_FALLBACK = float(os.getenv("TRAINING_HR_REST", "55"))
CTL_TC = 42                                               # constante de tempo (dias)
ATL_TC = 7
HRV_BASE_DAYS = 60
VO2_POWER = 1.06                                          # ajuste Riegel pelo VO2
# pesos do readiness (v1 iguais; ajustáveis)
W = {"sleep": 0.25, "hrv": 0.25, "tsb": 0.25, "acute": 0.25}
DIST_PR = {"pred_5k": ("5 km", 5.0), "pred_10k": ("10 km", 10.0),
           "pred_half": ("meia maratona", 21.1), "pred_mara": ("maratona", 42.2)}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def trimp(duration_s, avg_hr, hr_rest):
    if not duration_s or not avg_hr:
        return 0.0
    hfr = clamp((avg_hr - hr_rest) / (HR_MAX - hr_rest), 0.0, 1.0)
    return (duration_s / 60.0) * hfr * 0.64 * math.exp(1.92 * hfr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None,
                    help="reprocessar só os últimos N dias (defeito: tudo)")
    args = ap.parse_args()
    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select start::date, duration_s, avg_hr, kcal, distance_km, tss "
                "from public.activities order by start"
            )
            acts = cur.fetchall()
            cur.execute("select date, resting_hr, sleep_hours, hrv, vo2max from public.daily order by date")
            daily = cur.fetchall()
            cur.execute("select label, value_s, date from public.personal_records")
            prs = {label: (v, d) for label, v, d in cur.fetchall()}

        # ---- por-atividade -> TSS do dia ----
        rest_by_date = {d: r for d, r, _s, _h, _v in [(x[0], x[1], 0, 0, 0) for x in daily] if r}
        tss_by_day: dict = {}
        for start, dur, hr, kcal, km, tss in acts:
            if tss:
                t_ = float(tss)
            elif hr and dur:
                rest = rest_by_date.get(start) or HR_REST_FALLBACK
                t_ = trimp(dur, hr, rest)
            else:
                # sem FC: estimativa por kcal (aprox. 1 TSS ~ 6-7 kcal de carga dura)
                t_ = (kcal or 0) / 7.0 if kcal else 0.0
            tss_by_day[start] = tss_by_day.get(start, 0) + t_

        # ---- série diária completa ----
        d0 = min([a[0] for a in acts])
        today = date.today()
        rest_map = {d: (r, s, h, v) for d, r, s, h, v in daily}

        ctl = atl = 0.0
        rows = []
        d = d0
        while d <= today:
            t = tss_by_day.get(d, 0.0)
            ctl += (t - ctl) / CTL_TC
            atl += (t - atl) / ATL_TC
            tsb = ctl - atl
            rows.append({"date": d, "tss": round(t), "ctl": round(ctl, 1),
                         "atl": round(atl, 1), "tsb": round(tsb, 1)})
            d += timedelta(days=1)

        # ACR por dia (média 7d / média 28d de TSS)
        for i, r in enumerate(rows):
            w7 = sum(x["tss"] for x in rows[max(0, i - 6):i + 1]) / min(7, i + 1)
            w28 = sum(x["tss"] for x in rows[max(0, i - 27):i + 1]) / min(28, i + 1)
            r["acr"] = round(w7 / w28, 2) if w28 > 0 else None

        # ---- banda pessoal de HRV (60d) ----
        hrv_by_date = {dd: h for dd, _r, _s, h, _v in daily if h}
        for i, r in enumerate(rows):
            d = r["date"]
            vals = [hrv_by_date[x] for x in
                    [d - timedelta(days=k) for k in range(HRV_BASE_DAYS)] if x in hrv_by_date]
            if len(vals) >= 14:
                r["hrv_base_min"] = round(min(vals), 1)
                r["hrv_base_avg"] = round(sum(vals) / len(vals), 1)
                r["hrv_base_max"] = round(max(vals), 1)

        # ---- readiness ----
        sleep_by_date = {dd: s for dd, _r, s, _h, _v in daily if s}
        for i, r in enumerate(rows):
            d = r["date"]
            parts = {}
            # sono vs média 30d
            s30 = [sleep_by_date.get(x["date"]) for x in rows[max(0, i - 30):i + 1]]
            s30 = [x for x in s30 if x]
            s = sleep_by_date.get(d)
            if s and s30:
                avg = sum(s30) / len(s30)
                parts["sleep"] = clamp(s / avg * 100, 0, 100)
            # HRV vs banda
            h = hrv_by_date.get(d)
            if h and r.get("hrv_base_min"):
                if h >= r.get("hrv_base_avg", 0):
                    parts["hrv"] = 100
                elif h >= r.get("hrv_base_min", 0):
                    parts["hrv"] = 70
                else:
                    parts["hrv"] = 20
            # TSB
            parts["tsb"] = clamp(50 + r["tsb"], 0, 100)
            # carga aguda (ACR)
            acr = r.get("acr")
            if acr is None:
                parts["acute"] = 50
            elif 0.8 <= acr <= 1.3:
                parts["acute"] = 100
            elif acr < 0.8:
                parts["acute"] = 70
            elif acr <= 1.5:
                parts["acute"] = 50
            else:
                parts["acute"] = 30
            score = sum(W[k] * v for k, v in parts.items()) / sum(W[k] for k in parts)
            r["readiness"] = round(score)

        # ---- predições Riegel (PR + VO2máx) ----
        vo2_by_date = {dd: v for dd, _r, _s, _h, v in daily if v}
        # VO2 de referência na altura de cada PR (PRs antigos: primeiro VO2 conhecido)
        vo2_series = sorted(vo2_by_date.items())
        first_vo2 = vo2_series[0][1] if vo2_series else None
        pr_vo2 = {}
        for col, (label, _dist) in DIST_PR.items():
            pr = prs.get(label)
            if not pr:
                continue
            pr_time, pr_date = pr
            prior = [v for dd, v in vo2_series if dd <= pr_date]
            pr_vo2[col] = (pr_time, prior[0] if prior else first_vo2)
        last_vo2 = None
        for r in rows:
            v = vo2_by_date.get(r["date"]) or last_vo2
            last_vo2 = v
            if not v:
                continue
            for col, (pr_time, pr_v) in pr_vo2.items():
                if pr_v:
                    r[col] = round(pr_time * (pr_v / v) ** VO2_POWER, 1)

        # ---- streak de dias ativos + km acumulado do mês ----
        km_by_day: dict = {}
        with conn.cursor() as cur:
            cur.execute(
                "select start::date, distance_km, type from public.activities "
                "where distance_km is not null order by start"
            )
            for d, km, ttype in cur.fetchall():
                if ttype in ("running", "trail_running", "treadmill_running") and km:
                    km_by_day[d] = km_by_day.get(d, 0.0) + float(km)
        run_km_month = {}
        streak_run = 0
        for i, r in enumerate(rows):
            d = r["date"]
            # streak: dias consecutivos com atividade (tss>0); hoje vazio não quebra
            prev_active = rows[i - 1]["tss"] > 0 if i > 0 else False
            if r["tss"] > 0:
                streak_run = (rows[i - 1].get("streak") or 0) + 1 if prev_active else 1
            else:
                streak_run = 0 if d != today else ((rows[i - 1].get("streak") or 0) if i > 0 else 0)
            r["streak"] = streak_run
            # km do mês (acumulado, só corridas)
            mkey = (d.year, d.month)
            run_km_month[mkey] = round(run_km_month.get(mkey, 0.0) + km_by_day.get(d, 0.0), 1)
            r["month_km"] = run_km_month[mkey]
        to_write = rows if args.days is None else rows[-args.days:]
        with conn.cursor() as cur:
            cur.execute("delete from public.training_load")
            cur.executemany(
                """
                insert into public.training_load
                    (date, tss, ctl, atl, tsb, acr, readiness,
                     hrv_base_min, hrv_base_avg, hrv_base_max,
                     pred_5k, pred_10k, pred_half, pred_mara,
                     streak, month_km)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (date) do update set
                    tss = excluded.tss, ctl = excluded.ctl, atl = excluded.atl,
                    tsb = excluded.tsb, acr = excluded.acr,
                    readiness = excluded.readiness,
                    hrv_base_min = excluded.hrv_base_min,
                    hrv_base_avg = excluded.hrv_base_avg,
                    hrv_base_max = excluded.hrv_base_max,
                    pred_5k = excluded.pred_5k, pred_10k = excluded.pred_10k,
                    pred_half = excluded.pred_half, pred_mara = excluded.pred_mara,
                    updated_at = now()
                """,
                [
                    (r["date"], r["tss"], r["ctl"], r["atl"], r["tsb"], r.get("acr"),
                     r.get("readiness"), r.get("hrv_base_min"), r.get("hrv_base_avg"),
                     r.get("hrv_base_max"), r.get("pred_5k"), r.get("pred_10k"),
                     r.get("pred_half"), r.get("pred_mara"),
                     r.get("streak"), r.get("month_km"))
                    for r in to_write
                ],
            )
        conn.commit()
        today_row = [r for r in rows if r["date"] == today][-1]
        print(f"training_load: {len(to_write)} dias | hoje: TSS {today_row['tss']} "
              f"CTL {today_row['ctl']} ATL {today_row['atl']} TSB {today_row['tsb']} "
              f"readiness {today_row.get('readiness')} "
              f"| pred 5k {today_row.get('pred_5k')}s 10k {today_row.get('pred_10k')}s")


if __name__ == "__main__":
    sys.exit(main())
