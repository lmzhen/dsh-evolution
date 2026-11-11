## Qué hace

Convierte una sesión normal de Harness en una que se mejora sola: el agente recuerda lo que aprendió, mantiene una biblioteca de skills, revisa su propio trabajo, hace el merge de los skills duplicados y los cura con el tiempo. Sus datos se quedan en tu DSH home, mientras que las llamadas al modelo van al proveedor que tengas configurado.

## Qué incluye

- Memoria: una herramienta `memory` que ve el modelo, respaldada por un almacén local de memoria por capas.
- Skills: la herramienta `skill_manage`, un catálogo que el agente puede cargar y un workbench del historial de skills.
- Revisión y merge: revisión en segundo plano, redacción de skills en dos rondas y una aprobación del merge que puedes activar.
- Curación y mantenimiento: comprobaciones del ciclo de vida, escaneos de desviaciones y una vista de salud de solo lectura que viene desactivada.
- Comandos: `/evolution pending`, `curator`, `maintain` y `doctor` funcionan en cualquier sesión, con panel o sin él.

## Dónde se configura

Cada parámetro editable se ajusta en el componente que lo define, donde el panel muestra el valor actual, el predeterminado con el que se entrega y si lo modificaste. La mayoría de los cambios se aplican al momento; unos pocos ajustes de despliegue necesitan reiniciar. Los parámetros que no tocas se quedan en el predeterminado.

## Notas

Las escrituras normales de memoria y de skills se aprueban automáticamente. Solo si activas la aprobación de escrituras entran en la lista de pendientes, y entonces cada una espera tu aprobación o rechazo antes de aplicarse. La vista de salud viene desactivada. El merge de skills tiene su propio ajuste de aprobación, independiente de la aprobación de escrituras, y deja un recibo con el que puedes deshacerlo.
