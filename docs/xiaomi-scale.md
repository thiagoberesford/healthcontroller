# Balança Xiaomi — leitura BLE no macOS (automática, sem export)

## Formato confirmado (raw real, MIBFS, 2026-10-03)

A balança anuncia como **"MIBFS"** com service data no UUID **0x181B**:

```
02 a6 ea 07 0a 03 0b 15 29 40 02 e6 4b
│  │  └── ano 2026, 10-03 11:21:41    │  └─ peso LE
│  └─ ctrl1: bit5 estabilizado, bit7 anúncio FINAL └─ impedância LE (576 Ω)
└─ ctrl0: bit1 = catty (peso raw*0.005 kg, == /200 do openScale)
```

Peso raw 19430 → **97,15 kg** (confirmado contra o visor).
O anúncio com bit7 ativo é o **final** (depois de sair da balança) — é o
que se guarda; os frames sem bit5 são medições em curso e são ignorados.

## Teste com pesagem real

```bash
cd backend
mkdir -p logs
.venv/bin/python scripts/scale_listener.py --once --duration 90 --dry-run
```

Pisa a balança (liga os anúncios ~15 min), sobe, espera estabilizar (~5s).
O script imprime o raw hex + a descodificação:

```
[..] MI BODY COMP SCALE 2 (A4:C1:..)
  raw (13B): 0022503cea070a03072df40100
  PESAGEM: 77.2 kg | 500 Ω | comp: {'bmi': 23.8, 'body_fat': 22.1, ...}
```

**Confirma**: o peso deve bater certo (±0,1 kg) com o mostrado no visor.
Compara gordura/água com a app Mi Fitness — se divergirem, os pesos do
`compute_composition()` (openScale) afinam-se num sítio só
(`scale_listener.py`); o raw fica sempre em `data/scale_log.jsonl`, por
isso recalcular é trivial.

## Instalar o LaunchAgent (corre contínuo desde o login)

```bash
mkdir -p ~/Library/LaunchAgents backend/logs
cp backend/launchd/com.healthcontroller.scale.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.healthcontroller.scale.plist

# verificar
launchctl list | grep healthcontroller   # PID ativo = a correr
tail -f backend/logs/scale_listener.log

# parar / remover
launchctl unload ~/Library/LaunchAgents/com.healthcontroller.scale.plist
```

`KeepAlive` relança o processo se o Bluetooth oscilar; o listener também
reinicia o scanner sozinho a cada erro (loop com backoff de 15s).
O macOS pode pedir permissão de Bluetooth na primeira execução — aprovar
para o Python/terminal.

## Configuração (backend/.env)

```
SCALE_AGE=36
SCALE_HEIGHT_CM=180
SCALE_SEX=male
SUPABASE_DB_URL=postgresql://...   # já existente
```

## Fluxo dos dados

pesagem → anúncio BLE 0x181D → decode (peso, impedância) → composição
(openScale) → (a) `data/scale_log.jsonl` (raw, sempre) → (b) upsert
`body_metrics` (source='xiaomi', uma linha por dia, upsert idempotente).

## Plano B (se o bleak não vir os anúncios no macOS)

O CoreBluetooth filtra alguns adv BLE. Se o `--once` não apanhar nada:

1. Pisar a balança ANTES de lançar o scan (os anúncios só existem ~15 min
   após uso) e repetir; também verificar Permissões de Bluetooth.
2. Scan sem filtro para confirmar que a balança é vista:
   `bleak-scan` ou `BleakScanner` sem callback de nome.
3. Se o macOS não retransmitir o service data 0x181D: ligar ao device
   (BLE connect, service 0x181B, characteristic 0x2A9C, handle 0x13) com
   `BleakClient` — mais fiável mas exige connect por pesagem.
4. Último recurso: manter o fluxo manual (SmartScaleConnect → body_sync.py).
