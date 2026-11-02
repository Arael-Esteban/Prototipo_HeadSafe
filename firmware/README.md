# Firmware HeadSafe — ESP32 Wi-Fi local

Firmware educativo; no es equipo médico ni protección certificada. `HeadSafe/HeadSafe.ino` es el único sketch de esta entrega. No utiliza BLE, teléfono, GPS, batería simulada, service worker ni recursos CDN.

## Arduino IDE

1. Instalar soporte **esp32 by Espressif Systems 3.3.2** mediante el gestor de placas. Referencia oficial: https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html
2. Abrir `firmware/HeadSafe/HeadSafe.ino`. Seleccionar **ESP32 Dev Module** (ESP32 clásico; confirmar modelo y tamaño de flash de la placa real). La compilación entregada usa la partición **Default**, máximo de aplicación 1 310 720 bytes. No requiere Huge APP.
3. Elegir únicamente el puerto identificado de la placa conectada y cargar desde IDE. Esta entrega se compiló sin cargar ni conectar hardware.
4. Monitor serie **115200**. Reiniciar: muestra SSID `HeadSafe-…`, contraseña WPA2 generada/persistida en NVS y URL. Conectar a esa Wi-Fi aunque el teléfono indique «sin Internet» y abrir la URL mostrada, normalmente `http://192.168.4.1`.

`config.h` deja SSID/contraseña LAN vacíos: AP directo. Opcionalmente configurar STA propio; después de 15 s sin conexión inicia AP, también tras desconexión. No incluir credenciales reales en archivos distribuidos. No exponer este servidor a Internet. El token no autentica personas: cualquier cliente de la WLAN puede leer estado/token y solicitar reset. HTTP sin TLS.

## Pines y regla conservada

- MPU6050 dirección `0x68`, SDA26/SCL27, alimentación y niveles lógicos compatibles con 3.3 V; GND común. Confirmar módulo exacto y resistencias pull-up. No aplicar señales de 5 V al ESP32.
- Rojo12, verde14, buzzer33; botón25 con `INPUT_PULLUP`, pulsador a GND. LEDs necesitan resistencias; cargas/buzzer deben respetar corriente GPIO o usar etapa de manejo. GPIO12 es pin de strapping: evitar circuito que lo fuerce alto durante arranque; verificar físicamente.
- Disparo **`abs(int32_t(ax)) + abs(int32_t(ay)) > 65000`**, cuentas crudas, no Newtons ni aceleración resultante. ±2 g explícitos. Alarma enclavada; solo reset remoto válido o flanco físico estable de 35 ms. Una pulsación sostenida no repite reset.
- Buzzer alterna 900/600 Hz cada 150 ms sin `delay()`. Muestreo continúa durante alarma. Error de sensor nunca enciende verde y conserva alarma anterior. HTTP corre en tarea separada; no es garantía formal de tiempo real.
- Lectura de 6 bytes desde `0x3B`: acelerómetro X/Y/Z en offsets0/2/4, como en el código original. No se añade telemetría del giroscopio. Rango leído al iniciar y cada segundo. Lectura corta/inválida marca sensor no válido; reintento de configuración cada segundo. DLPF44Hz, divisor4, `sampleRateHz:200` expresa configuración, no tasa efectiva medida.

## API y recursos offline

- `GET /api/status`: contrato hardware, acelerómetro crudo X/Y/Z, suma horizontal, peak, umbral65000, flags, eventos newest-first32 RAM, sequence por evento, uptimeMs, bootId y resetToken. Muestras crudas anteriores pueden permanecer con flag inválido. `resetCommandsRemaining` empieza en128. No hay campos de GPS, batería ni giroscopio.
- `POST /api/reset`: `Content-Type: application/json`, header `X-HeadSafe-Token`, cuerpo exacto `{"commandId":"id-unico"}`. ID1–64 ASCII `[-_.:A-Za-z0-9]`. JSON sin campos extra/duplicados, escapes ni NUL. Hasta128 IDs únicos por arranque; después429. Duplicados reconocen estado actual sin borrar un impacto nuevo; IDs nunca se expulsan.
- Host solo IP numérica de interfaces activas (con o sin `:80`), rechaza nombres DNS/rebinding. Origin ausente o HTTP del mismo Host. Sin CORS ni `/api/simulate`.
- `web-assets.json` permite únicamente panel raíz, guía estática, CSS/JS necesarios, favicon, heroWebP, diagrama de cableadoSVG, fuenteManropeTTF y licenciaOFL. Todos comprimidos gzip determinista en PROGMEM; se envía `Content-Encoding:gzip` y longitud binaria explícita. Se asumen navegadores modernos con gzip. `Cache-Control:no-store` para API y recursos; CSP local y workers bloqueados.
- Los recursos están dentro de `web_assets.h`: **no subir archivos a SPIFFS/LittleFS**. Cualquier cambio web exige regenerar y recompilar.

## Verificación y build sin cargar

Desde raíz, Python3 y ArduinoCLI disponibles:

```sh
python firmware/build.py --install-core  # instalación explícita inicial, requiere Internet
python firmware/build.py                 # regenera recursos y compila
python tests/firmware_run.py              # C++ real + gzip/contratos; requiere CXX o Zig
```

También puede usarse CLI local `firmware/.toolchain/arduino/arduino-cli.exe`. Para esta máquina se reutilizaron ejecutables y paquetes de la entrega anterior sin modificar su fuente. `--reuse-toolchain RUTA` registra ubicación local en `.toolchain/reuse-toolchain.json`; copia índices y herramientas builtin a directorios nuevos, y usa enlaces duros para herramientas/core inmutables. No permite instalar/actualizar core en modo reuse. Configuración, cachés Zig/Arduino, compilación y salidas permanecen en **este proyecto**. No editar los paquetes enlazados: comparten contenido con el original. No distribuir `.toolchain` ni `.build`.

```sh
python firmware/build.py --reuse-toolchain "C:/ruta/anterior/firmware/.toolchain"
```

`build.py` solo compila, nunca upload. `--ports` solo enumera. `--huge-app` es alternativa explícita para futuros recursos mayores y exige confirmar flash4MB y seleccionar Huge APP3MB en IDE; no se usó para el binario actual.

Salidas: `build/HeadSafe.ino.bin` aplicación, bootloader/partitions/merged.bin del CLI, `compile.log`, `build/build-provenance.json` con hashes SHA256 de fuentes/recursos y binarios. `baseline-provenance.json` permite comprobar originales copiados. `tests/firmware_assets.py` descomprime los recursos reales y detecta fuente stale. Si se modifican fuentes durante compilación, el build rechaza declarar resultado final; repetir con frontend terminado.

Las pruebas nativas comprueban lectura de acelerómetro, umbral y signed-min, latch/fallos, historial32, debounce/reloj, tonos, comandos128/idempotencia, JSON y Host/Origin. Los tests de integración de fuente no reemplazan HTTP en placa. Compilación y pruebas de software no prueban cableado, sensor, Wi-Fi físico ni latencia bajo carga: **validación física pendiente**.

Referencias de implementación: WebServer.h del tag oficial3.3.2 (sobrecarga `send_P(...,size_t)`), y mapa oficial MPU6000/6050 Rev4.2 de TDK/InvenSense, registros del acelerómetro desde0x3B.
