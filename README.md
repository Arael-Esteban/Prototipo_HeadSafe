# HeadSafe · ESP32

Versión Wi-Fi con el diseño original de HeadSafe. La ESP32 toma las lecturas del MPU-6050 y sirve el panel directamente a móviles y computadoras.

**Empieza por `LEEME.txt`.** Incluye conexiones, carga del firmware y acceso a la web.

## Incluye

- Panel de estado, actividad y conexión del dispositivo.
- Alarma enclavada, reinicio remoto confirmado y pulsador físico.
- Registro de eventos y exportación CSV.
- Lecturas X/Y/Z y suma horizontal con el umbral original del firmware.
- Modo demo independiente, identificado como simulación.
- Guía de uso dentro del panel y diagrama de conexiones actualizado.

No utiliza sensores del teléfono, Bluetooth, GPS ni un servidor externo para operar con la placa. Se retiraron contactos, perfiles, calibración desde la web y otros controles ajenos al firmware. No se inventan lecturas de batería ni se envían avisos automáticos.

## Demo en computadora

Requiere Node.js 22 o superior:

```sh
npm start
```

Abre `http://127.0.0.1:8767`. No hace falta instalar paquetes para ejecutar la demo.

## Desarrollo

```sh
npm ci
npm test
npm run test:browser
python tests/firmware_run.py
python firmware/build.py
```

Si modificas HTML, CSS, JavaScript o recursos, regenera la web y recompila el firmware. Los archivos originales del proyecto anterior y su ZIP permanecen separados.

`verification/` contiene resultados de pruebas. La compilación y la simulación no sustituyen la comprobación del montaje físico. El dispositivo usa HTTP en una red local de confianza; no debe exponerse directamente a Internet.

La tipografía Manrope se distribuye con su licencia en `assets/fonts/OFL.txt`. Las imágenes de diseño proceden del proyecto original aportado.
