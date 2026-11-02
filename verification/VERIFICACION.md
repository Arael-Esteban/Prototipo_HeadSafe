# Verificación de la entrega

## Alcance

Versión separada basada en el diseño original de HeadSafe. Se conservan Inicio, Actividad, Dispositivo y Guía. Solo se incluyen funciones respaldadas por el firmware: acelerómetro X/Y/Z, suma horizontal, alarma enclavada, estado de conexión/sensor, eventos y restablecimiento. El modo demo está identificado y no ejecuta firmware en una placa virtual.

Se retiraron contactos, perfiles, cuenta regresiva, avisos automáticos, GPS, batería estimada, Bluetooth, sensores del teléfono, audio web, ajustes de sensibilidad y telemetría de giroscopio.

## Pruebas ejecutadas

- `npm test`: **28 aprobadas, 0 fallidas**. Servidor y contrato de interfaz en Brave, incluidos datos caducados, reanudación de pestañas, reinicios sin confirmar, repetición idempotente, límites de comandos, desconexión, sensor averiado, exportación CSV y almacenamiento local no disponible.
- `npm run test:browser`: **7 aprobadas**. Recorrido impacto → aviso → cierre sin borrar alarma → reinicio confirmado → CSV; tamaños 360, 390, 768 y 1440 px; desconexión, contrato hardware sin controles de demo y guía móvil.
- `npm run test:live`: **1 aprobada**, contra el servidor de demostración real del proyecto. Se repitió el recorrido en los cuatro tamaños, sin errores de página ni solicitudes a servicios externos.
- Lanzador: **1 prueba aprobada**; utiliza el puerto 8767, distinto de la primera entrega.
- Núcleo C++ del firmware: compilado y ejecutado realmente en Windows. Pruebas de umbrales, valores con signo, enclavamiento, sensor inválido, botón, tonos, eventos, JSON, Host/Origin e idempotencia aprobadas.
- Recursos del firmware: **2 pruebas aprobadas**; se descomprimen los recursos generados y se comparan con los archivos actuales. Contrato de fuente: **4 pruebas aprobadas**.
- `node --check` de cliente y servidor: correcto. Auditoría de dependencias de ejecución: sin vulnerabilidades detectadas.

Los tamaños móviles se comprobaron en navegador de escritorio con viewport emulado; no son pruebas en teléfonos físicos ni en Safari/iOS. Los contratos sintéticos de hardware no equivalen a una conexión física.

## Firmware compilado

Arduino CLI 1.4.1, core esp32 3.3.2, placa `esp32:esp32:esp32`, partición Default. No necesita Huge APP ni copiar archivos a SPIFFS/LittleFS.

Salida del compilador: **1.103.319 bytes de programa** y **55.752 bytes de variables globales**. La web, imagen, fuente y guía están comprimidas e incluidas en el firmware. `firmware/build/build-provenance.json` vincula las fuentes y los binarios mediante SHA-256.

## Conservación del original

Se verificaron los hashes del ZIP aportado, del ZIP de la primera entrega y de sus archivos principales. No se modificaron. Esta versión usa una carpeta, servidor y entregable ZIP independientes.

## Pendiente de montaje físico

No se conectó ni grabó una ESP32. Queda pendiente verificar alimentación, cableado, lectura real del MPU6050, Wi-Fi de la placa, LED, pulsador y buzzer. El firmware compilado y las pruebas de software no certifican estas conexiones físicas.

Se mantiene el umbral original de 65000 cuentas crudas; está próximo al máximo de la suma y requiere validación experimental. No mide fuerza en newtons, no diagnostica lesiones y no constituye equipo de protección certificado. HTTP local sin TLS ni usuarios individuales: usar únicamente en una WLAN de confianza y no exponer a Internet.

## Registros

Los archivos `.log`, el informe `browser-results.json` y las capturas de esta carpeta permiten consultar los resultados. Para instalar y usar el equipo, basta seguir `LEEME.txt`.
