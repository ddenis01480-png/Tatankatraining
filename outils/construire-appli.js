// Lancer : node outils/construire-appli.js
// Place outils/env-appli.js comme script d'environnement d'index.html (rien d'autre ne change),
// puis refabrique coach.html a partir du nouvel index.html.
const fs = require('fs'), path = require('path');
const { construire } = require('./construire-coach.js');
const R = path.join(__dirname, '..');
const idx = construire(fs.readFileSync(path.join(R, 'index.html'), 'utf8'), fs.readFileSync(path.join(__dirname, 'env-appli.js'), 'utf8'), 'Tatanka Training');
fs.writeFileSync(path.join(R, 'index.html'), idx);
fs.writeFileSync(path.join(R, 'coach.html'), construire(idx, fs.readFileSync(path.join(__dirname, 'env-coach.js'), 'utf8')));
console.log('index.html et coach.html ecrits');
