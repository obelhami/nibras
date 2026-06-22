# P1 — Validation & Errors Standard

## Format d'erreur uniforme

Toutes les routes de **Projects API**, **Teams API** et **Tasks API** (Ilham)
retournent le même format d'erreur :

```json
{
  "message": "Description lisible de l'erreur",
  "code": "ERROR_CODE"
}
```

`message` : texte lisible, sans détails techniques sensibles (pas de stack trace, pas de requête SQL, pas de nom de colonne interne).

`code` : identifiant machine stable, utilisable côté frontend pour brancher la logique sans parser le texte.

---

## Codes d'erreur disponibles

| Code | HTTP | Quand |
|---|---|---|
| `UNAUTHORIZED` | 401 | Token absent, invalide ou expiré |
| `FORBIDDEN` | 403 | Token valide mais rôle insuffisant ou hors scope |
| `NOT_FOUND` | 404 | Ressource introuvable |
| `VALIDATION_ERROR` | 400 | Données invalides dans le body ou les query params |
| `CONFLICT` | 409 | Doublon (email déjà membre, team déjà liée, etc.) |
| `INTERNAL_ERROR` | 500 | Erreur serveur inattendue |

---

## Utilisation dans le code

Le fichier `src/lib/errors.ts` exporte des fonctions prêtes à l'emploi :

```ts
import { unauthorized, forbidden, notFound, validationError, conflict, internalError, permissionDenied } from '../lib/errors';

// Exemples
return unauthorized(set);                         // 401
return forbidden(set, 'Accès refusé');            // 403
return notFound(set, 'Projet introuvable');        // 404
return validationError(set, 'Nom obligatoire');   // 400
return conflict(set, 'Déjà membre');              // 409
return internalError(set);                        // 500

// Cas spécial : après requirePermission() qui fixe déjà set.status à 401 ou 403
return permissionDenied(set); // respecte le 401/403 déjà positionné
```

---

## Schémas de validation Elysia

Toutes les routes qui acceptent un body déclarent leur schéma via `t.Object(...)` :

```ts
.post('/projects', async ({ body, set }) => {
  // ...
}, {
  body: t.Object({
    name: t.String(),
    description: t.Optional(t.String()),
    startDate: t.Optional(t.String()),
    endDate: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),
})
```

Elysia rejette automatiquement les requêtes dont le body ne correspond pas
au schéma (types incorrects, champs obligatoires manquants) avec une réponse
400 avant même que le handler soit appelé.

---

## Extension recommandée

Ce standard est actuellement appliqué sur les routes Projects, Teams et Tasks API.
Pour une cohérence complète de l'API Nibras, il est recommandé d'adopter
progressivement ce même format sur les autres modules au fur et à mesure
des prochains sprints, en coordination d'équipe.