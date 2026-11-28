// Lancer : node outils/construire-coach.js
// Fabrique coach.html a partir d'index.html : MEME appli, seul le script d'environnement (en tete de page)
// est remplace par outils/env-coach.js. Aucune autre difference (verifie par tests/page-coach.test.js).
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..');
function construire(indexSrc, envSrc, titre) {
  const m = /\/\/ ENVIRONNEMENT DE (TEST|L'APPLI)/.exec(indexSrc), debut = m ? m.index : -1;
  if (debut < 0) throw new Error('script environnement introuvable dans index.html');
  const a = indexSrc.lastIndexOf('<script>', debut) + '<script>'.length, b = indexSrc.indexOf('</script>', debut);
  const avant = indexSrc.slice(0, a), apres = indexSrc.slice(b);
  return avant.replace('<title>Tatanka Training</title>', '<title>' + (titre === undefined ? 'Tatanka Training · Coach' : titre) + '</title>') + '\n' + envSrc.replace(/^\/\/ =+\n/, '// ============================================================\n') + apres;
}
if (require.main === module) {
  const out = construire(fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8'), fs.readFileSync(path.join(__dirname, 'env-coach.js'), 'utf8'));
  fs.writeFileSync(path.join(RACINE, 'coach.html'), out);
  console.log('coach.html ecrit (' + out.length + ' caracteres)');
}
module.exports = { construire };
