# ATUM Frontend (conectado a THOT backend)

## Backend esperado
Este frontend está alineado con tu `main.py` FastAPI:

- GET  `/health`
- POST `/compute`
- POST `/global_rms`
- POST `/dwarfs`

Payloads:
- `/compute`: `{ galaxy_name: str, rows: [{R_kpc,Vobs,Vgas,Vdisk,Vbul}] }`
- `/global_rms` y `/dwarfs`: `{ galaxies: [{ galaxy_name, rows:[...] }] }`

## ZIP desde repo (GitHub Pages)
- Subí el ZIP al mismo repo (por defecto: `./Rotmod_LTG.zip`).
- La UI lo baja con `fetch()` y lo abre con `JSZip`.

## Curva
- Siempre grafica OBS desde el CSV.
- Si el backend devuelve una curva del modelo (en `macro.curve`/`macro.points`/etc), la superpone.

## Deploy
- Copiá `index.html` y `app.js` al root del repo ATUM.
- Asegurate que el ZIP esté en la ruta indicada.
