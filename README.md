# THOT Engine — ATUM (Micro + Macro)  
**Powered by THOT**

Motor físico unificado para **cálculos Micro–Macro** sin parámetros libres, sin “perillas” y sin calibración manual.

---

## Qué es esto

**THOT Engine** es el backend de cálculo de ATUM: recibe datos observacionales (rotación, perfiles, etc.) y devuelve predicciones y métricas (RMS) usando un **motor matemático unificado**.

- **Macro:** galaxias (175), enanas y cúmulos (LoCuSS ~40), procesados por lote o individualmente.
- **Micro:** módulo de partículas/constantes (W bosón, Z pole, muón) para el bloque microfísico del motor.

> El objetivo del proyecto es demostrar **física de la realidad**: el motor no usa ajustes ad-hoc ni “tuneos” por objeto.

---

## Principio clave: sin parámetros ni perillas

Este motor trabaja con un **conjunto fijo de ecuaciones**.  
No existe un panel de “parámetros libres” para forzar el resultado.

- No hay calibración por galaxia.
- No hay parámetros “ocultos” para bajar RMS.
- No hay perillas para acomodar un caso y romper otro.

**El sistema está diseñado para que una misma estructura de cálculo sirva en todo el rango micro–macro**.

---

## “Física de la realidad” y muestra mínima

El motor se valida con una **muestra mínima** (datos observacionales medibles), evitando inflar entradas o “inventar” variables.

- Se prioriza el uso de datos crudos y observables.
- Se busca minimizar supuestos adicionales.
- La evaluación se reporta con métricas cuantitativas (p. ej., RMS).

> Si el motor acierta sin ajustar, la evidencia apunta a consistencia física, no a ajuste estadístico.

---

## Arquitectura (alto nivel)

- Frontend (web) carga datasets (ZIP con .dat/.csv) y solicita cálculo al backend.
- Backend (FastAPI) ejecuta el motor matemático y devuelve:
  - Curvas predichas (p. ej., `V_pred` vs `R`)
  - RMS por objeto y RMS global por lote
  - Bloque micro (constantes/escala micro del motor)

---

## Endpoints principales

- `GET /health`  
  Verifica estado del backend.

- `POST /compute`  
  Ejecuta Micro+Macro para un objeto individual (galaxia/curva).

- `POST /global_rms`  
  Ejecuta lote (galaxias/cúmulos) y devuelve RMS global + RMS por objeto.

- `POST /dwarfs`  
  Ejecuta lote específico para enanas (según dataset/criterio de selección).

- `POST /micro`  
  Ejecuta micro-only (W/Z/MUON según configuración del proyecto).

---

## Propiedad intelectual y protección

Este software, en su totalidad (motor matemático, implementación y componentes asociados), se encuentra **protegido por patente INPI (Argentina)** y por **patente internacional**.

- **Uso, copia, modificación o redistribución no autorizada** están prohibidos.
- El acceso al motor es a través del backend **Powered by THOT**.

> Para licenciamiento, integración o acuerdos institucionales, contactar al autor.

---

## Autor

**Fabián Vallejos**  
ATUM / THOT Engine — Powered by THOT
