# Tema de la interfaz — entrega 2

Las variables están en `src/renderer/src/global.css`; los estilos privados usan CSS Modules. El selector **Día / Noche** cambia la interfaz entre fondo blanco y el azul original, incluidos los controles nativos de ventana. **Vista impresión** tiene un fondo independiente: Papel blanco inicialmente, o Fondo noche a elección del usuario. La salida impresa siempre usa blanco. El tema inicial del sistema es Noche; no se persisten preferencias ni se sigue automáticamente el tema de Windows. No hay importador de temas personalizados: los ejemplos siguientes requieren modificar el código y recompilar. La tabla describe los valores nocturnos de partida.

| Variable | Predeterminado | Tipo y alcance |
| --- | --- | --- |
| `--hiloo-window-background` | `#183550` | Color del fondo completo; inicializado desde TypeScript. |
| `--hiloo-bar` | `#203f5d` | Color de barra, menús, tooltips y fondos de código. |
| `--hiloo-border` | `#36556f` | Color de bordes y separadores. |
| `--hiloo-text` | `#edf3f8` | Color del texto de controles. |
| `--hiloo-muted` | `#b6c7d6` | Color de estado secundario, citas y marcadores. |
| `--hiloo-accent` | `#85c7ee` | Color de foco, controles activos, cursor, citas y enlaces. |
| `--hiloo-hover` | `#2e5271` | Color de fondo al pasar el puntero. |
| `--hiloo-active` | `#294d6b` | Color de fondo de herramientas activas. |
| `--hiloo-selection` | `#387096` | Fondo de selección de texto en el editor de código. |
| `--hiloo-on-accent` | `#203f5d` | Texto sobre botones con fondo de acento. |
| `--hiloo-ui-font` | `'Segoe UI', system-ui, sans-serif` | Familia tipográfica de controles y títulos del documento. |

Cada color acepta un valor CSS válido. Los valores definidos en `:root` alcanzan también los portales Radix. El modo Día los sobrescribe mediante `html[data-theme='day']`; la vista de impresión delimita su propia paleta de papel blanco. Una sobrescritura solo dentro de un componente no alcanza sus portales. Las declaraciones inválidas siguen las reglas normales de CSS; no existe validador de temas personalizados. Espaciados, radios, color de error y opacidad deshabilitada todavía son reglas internas.

Ejemplo de variación, al final de `global.css`:

```css
:root {
  --hiloo-bar: #244763;
  --hiloo-hover: #365e7d;
  --hiloo-accent: #a4d9fa;
  --hiloo-ui-font: 'Segoe UI', sans-serif;
}
```

El fondo inicial, los colores Día/Noche y los símbolos de los controles nativos provienen de `src/shared/window.ts`. El selector usa `window.appearance.setTheme` para actualizar fondo y botones nativos mediante IPC validado. Cambiar únicamente CSS en ejecución no sincroniza esos controles. La variable interna `--hiloo-titlebar-height` sincroniza la región de arrastre con los controles; no forma parte del tema público.

Los botones tienen nombre accesible, tooltip y foco de 2 px con el color de acento. Los formatos activos exponen `aria-pressed`; el selector de bloque es Radix Select. El área editable usa cursor de acento como indicación de foco. Cambiar colores exige volver a comprobar contraste, selección y foco. La barra se distribuye en más de una fila en ventanas estrechas; el mínimo es 420 × 300 unidades lógicas. No es una certificación completa WCAG ni una prueba con lector de pantalla.

Las clases generadas por CSS Modules son privadas y pueden cambiar. Las variables anteriores son el contrato de esta versión, sin garantía de compatibilidad entre versiones iniciales. La presentación del documento se describe por separado en [estilo Markdown](estilo-markdown.md).
