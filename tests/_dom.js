// Charge le VRAI index.html dans jsdom (scripts en ligne uniquement, JSX compile par Babel) SANS lancer l'application :
// les composants (Card, Btn, RoutinesTab...) deviennent disponibles pour un rendu reel avec React. Dev uniquement :
//   npm i react@18 react-dom@18 jsdom --no-save   (et @babel/core @babel/preset-react pour la compilation JSX)
const fs = require('fs'), path = require('path');
const MOD = process.env.TEST_MODULES || '/tmp/jsd/node_modules'; const req = n => require(require.resolve(n, { paths: [MOD, '/tmp/bchk/node_modules', process.cwd()] }));
const { JSDOM } = req('jsdom'); const React = req('react'); const ReactDOMClient = req('react-dom/client'); const ReactDOM = req('react-dom'); const babel = req('@babel/core');
const FILE = process.env.INDEX_FILE || path.join(__dirname, '..', 'index.html');
function loadApp(opts) {
  opts = opts || {}; const html = fs.readFileSync(FILE, 'utf8');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://tatanka.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.React = React; w.ReactDOM = Object.assign({}, ReactDOM, ReactDOMClient); w.alert = () => {}; w.confirm = () => true; w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  if (opts.alert) w.alert = opts.alert; if (opts.confirm) w.confirm = opts.confirm;
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g; let m, ran = 0, errors = [];
  while ((m = re.exec(html))) {
    const attrs = m[1], body = m[2]; if (/\bsrc=/.test(attrs) || !body.trim()) continue;
    let code = body;
    if (/type="text\/babel"/.test(attrs)) {
      const cut = code.lastIndexOf('ReactDOM.createRoot('); if (cut > 0) code = code.slice(0, cut);             // on ne demarre pas l'appli complete
      code = babel.transformSync(code, { presets: [[req('@babel/preset-react'), { runtime: 'classic' }]], filename: 'app.jsx' }).code;
    }
    try { dom.getInternalVMContext && require('vm').runInContext(code, dom.getInternalVMContext()); ran++; } catch (e) { errors.push(e.message); }
  }
  return { dom, w, React, createRoot: ReactDOMClient.createRoot, errors, ran, act: React.act };
}
module.exports = { loadApp, React };
