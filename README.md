# Data Factory to Microsoft Fabric Migration Assistant

Aplicacion web (SPA) que migra pipelines de Azure Data Factory y Azure Synapse a Microsoft Fabric. Funciona 100% en el navegador: analiza el ARM template, valida compatibilidad, mapea conectores y orquesta el despliegue en Fabric mediante Azure AD. No hay backend ni persistencia de datos; todo se procesa en memoria del navegador.

## Que hace

- Carga y analiza ARM templates de ADF/Synapse.
- Genera un perfil de componentes (pipelines, datasets, linked services, triggers).
- Aplica validaciones de compatibilidad y muestra advertencias.
- Mapea conexiones y prepara el despliegue hacia Microsoft Fabric.
- Ejecuta un flujo guiado por pasos para migracion (wizard).

## Ejecutar en local

Requisitos:
- Node.js 20+ (segun package.json)
- npm

Pasos:

```bash
npm install
npm run dev
```

Luego abre http://localhost:5173 en el navegador.

## Scripts utiles

- `npm run dev` inicia el servidor de desarrollo.
- `npm run build` compila para produccion.
- `npm run preview` previsualiza el build.
- `npm run lint` ejecuta el lint.
- `npm test` ejecuta tests.
