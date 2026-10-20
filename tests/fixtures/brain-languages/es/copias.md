# Copias de seguridad

Toda la información del taller (facturas, inventario, fichas de clientes) vive en un pequeño servidor en la trastienda. Perder esos datos sería un desastre, así que las copias de seguridad no se negocian.

## Frecuencia

El servidor hace una copia incremental cada noche a las dos y una copia completa los domingos. Además, el primer día de cada mes se copia todo a un disco externo que Raúl se lleva a casa. Las copias diarias se guardan treinta días y las mensuales, un año entero.

## Restauración

Una copia que nunca se ha probado no sirve de nada. Cada trimestre restauramos una carpeta al azar en un ordenador aparte y comprobamos que los archivos se abren sin errores. En la última prueba, restaurar la base de datos de clientes tardó cuarenta minutos. Si alguna restauración falla, se avisa ese mismo día a la empresa informática que nos da soporte.

## Cifrado

El disco externo está cifrado y la contraseña la conocen solo Raúl y la gerente. Las copias en la nube se cifran antes de subirse, de modo que el proveedor no puede leer su contenido. Cambiamos la contraseña cada vez que alguien con acceso deja la empresa.
