# git-commit-instructions.md

---

## Formato del commit

type: short description

### Ejemplos válidos

- feat: add signed file uploads
- fix: handle expired sessions
- docs: update deployment guide
- test: add ttl validation tests
- refactor: simplify item rendering
- chore: update r2 configuration

## Tipos permitidos

- feat: nueva funcionalidad
- fix: corrección de error
- docs: cambios en documentación
- test: pruebas unitarias o de integración
- refactor: mejora interna sin cambiar comportamiento esperado
- chore: tareas de mantenimiento o configuración
- style: cambios de formato sin alterar lógica
- build: cambios relacionados con build o dependencias
- perf: mejora de rendimiento

## Reglas para la descripción

1. Usar un verbo en presente.
2. No terminar con punto final.
3. Describir el cambio principal, no una historia larga.
4. Mantenerla idealmente entre 2 y 10 palabras.

## Ejemplos recomendados para Hopper

### Transferencias

- feat: add text transfer
- feat: add file upload progress
- feat: add image preview
- fix: preserve pasted whitespace

### Seguridad

- feat: add pin lockout
- feat: add recovery flow
- fix: validate session version
- test: add session token tests

### Expiración

- feat: add item countdown
- feat: add scheduled cleanup
- fix: reject expired downloads

### Documentación

- docs: update deployment guide
- docs: document recovery setup

## Decisión final

- Idioma de commits: English
- Formato obligatorio: type: short description

---
