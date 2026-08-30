# Novus Launcher

V1 du launcher Minecraft moddé de Novus.

## V1 actuelle

- Electron + Node.js
- Installation automatique de Minecraft 1.20.1
- Installation automatique du loader Fabric
- Téléchargement automatique de Fabric API et Create depuis Modrinth
- Vérification SHA-256 des fichiers téléchargés
- Réinstallation intelligente des fichiers déjà valides
- Interface de progression
- Lancement de l'instance avec le moteur XMCL
- Build Windows NSIS

## Installation développeur

Prérequis : Node.js 20+ et Java accessible avec `java` dans le PATH.

```bat
npm install
npm start
```

## Build Windows

```bat
npm run build
```

Le programme d'installation sera généré dans `dist/`.

## Important

La V1 utilise un profil local/offline pour permettre de tester le pipeline du launcher. Ce mode n'est pas destiné à rejoindre un serveur en ligne authentifié. La connexion Microsoft sera ajoutée dans la V1.1.

## Modpack

Le contenu du pack est défini dans `modpack/manifest.json`. Pour ajouter un mod hébergé sur Modrinth, ajoute son slug dans `mods` :

```json
{
  "project": "slug-modrinth",
  "name": "Mon mod"
}
```

Le launcher sélectionne automatiquement une version `release` compatible avec Minecraft et Fabric.
