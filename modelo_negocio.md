# hiloo — Modelo de negocio

Fecha: 2026-10-03. Estado: definición inicial; servicios online todavía sin implementar.

## Propuesta de valor

hiloo permite leer, escribir y organizar documentos Markdown en cuadernos locales. La oferta online añadirá almacenamiento, disponibilidad entre dispositivos, sincronización y recuperación de versiones.

El cobro por almacenamiento en nube es la dirección comercial aceptada. La suscripción debe ofrecer comodidad y continuidad del trabajo, además de capacidad para guardar archivos. La rentabilidad y la disposición a pagar deberán validarse con uso real.

## Oferta prevista

| Modalidad | Alcance |
| --- | --- |
| Hiloo local | Editor y cuadernos guardados en el equipo, utilizables sin suscripción a la nube. La gratuidad o licencia de pago único del editor sigue pendiente. |
| Hiloo nube | Suscripción opcional por almacenamiento, sincronización entre dispositivos y recuperación de versiones online. Capacidad, retención y límites por definir. |
| Hiloo equipos | Posible oferta posterior con cuadernos compartidos, permisos y colaboración. Alcance y forma de cobro pendientes. |

Los nombres de modalidades son descriptivos; no constituyen planes comerciales publicados.

## Reglas del producto

- El trabajo local debe seguir siendo útil sin contratar servicios online.
- Los archivos del usuario seguirán siendo Markdown y recursos accesibles; la portabilidad es parte del producto.
- La exportación completa incluirá notas, imágenes y otros recursos necesarios para conservar el cuaderno y sus enlaces relativos.
- Dejar la suscripción no debe inutilizar las copias locales ni impedir conservar una exportación. El plazo para exportar desde la nube y la política de eliminación o retención deberán definirse y comunicarse antes de vender el servicio.
- La sincronización y el historial son funciones distintas. No se prometerá recuperación ilimitada ni que sincronizar por sí solo proteja de borrados accidentales.
- Compartir por enlace y editar simultáneamente son ampliaciones futuras; no forman parte de la primera entrega del editor.
- hiloo no incorpora IA. El skill permite que herramientas externas trabajen con los cuadernos; no implica costes ni cobros por inferencia dentro de hiloo.

## Almacenamiento y recursos

Las notas Markdown suelen ocupar poco espacio. Las imágenes y los adjuntos pueden representar una parte mayor del consumo y del valor de los planes de capacidad.

El modelo previsto mantiene las imágenes como archivos separados, enlazados desde las notas. La sincronización y la exportación deberán tratar el cuaderno y sus recursos como un conjunto coherente.

Antes de fijar cuotas se definirá si el espacio contabiliza solo archivos actuales o también versiones, papelera y otros datos persistentes. La interfaz deberá explicar el consumo y el comportamiento al alcanzar el límite sin provocar pérdida de datos.

## Costes y validación de precios

Medir antes de publicar precios:

- Almacenamiento de documentos, imágenes y adjuntos.
- Transferencia de datos y descargas de enlaces compartidos.
- Historial, copias de seguridad y recuperación.
- Autenticación, base de datos y servicios de sincronización.
- Conexiones y mensajes de colaboración en tiempo real.
- Operación, soporte y procesamiento de pagos.

Validar con usuarios la utilidad de la sincronización, la capacidad necesaria y la disposición a pagar. Los costes recurrentes, los límites de uso y el margen esperado deben sostener cada plan.

## Viabilidad técnica futura

Electron permite incorporar comunicación online. Supabase es una opción a evaluar para cuentas, permisos, metadatos, almacenamiento y tiempo real. Un servicio gestionado sería el punto de partida propuesto; el autohospedaje requeriría mantenimiento y operación propios.

La edición simultánea requiere resolución de conflictos además del transporte de mensajes. Milkdown con Yjs es una alternativa a validar. Será necesario diseñar la persistencia, la reconexión y la convivencia con modificaciones externas sobre los `.md`.

Estas posibilidades no equivalen a una arquitectura online aprobada ni a servicios contratados. El desarrollo actual continúa con las entregas locales descritas en [STACK.md](STACK.md).

## Decisiones pendientes

Precios, moneda, periodicidad, cuotas, prueba gratuita, licencia del editor local, retención de versiones, política al cancelar, permisos para compartir, oferta para equipos, proveedor definitivo y calendario de funciones online.
