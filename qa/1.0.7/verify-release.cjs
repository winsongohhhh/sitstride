'use strict';

// Run from any directory after the 1.0.7 builds exist: node qa/1.0.7/verify-release.cjs
// Native Windows shortcut creation is intentionally not exercised in this Linux environment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const asar = require('@electron/asar');
const R = require('resedit');

const root = path.resolve(__dirname, '../..');
const version = '1.0.7';
const out = path.join(root, 'release', version);
const sourceAssetsManifest = path.join(root, 'qa/1.0.5/designer-assets.json');
const preservedManifest = path.join(root, 'qa/1.0.7/preserved-previous.sha256');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = f => fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f));
const exists = f => fs.existsSync(f);
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, version, 'package.json version');
const lock = JSON.parse(read('package-lock.json'));
assert.equal(lock.version, version, 'package-lock version');
assert.equal(lock.packages[''].version, version, 'package-lock root package version');

const expectedSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
function sourceIcon() {
  const ico = read('app/assets/icon.ico');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
  assert.equal(ico.readUInt16LE(4), expectedSizes.length, 'ICO image count');
  const icons = [];
  for (let i = 0; i < expectedSizes.length; i++) {
    const at = 6 + 16 * i;
    const width = ico[at] || 256, height = ico[at + 1] || 256;
    const length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    assert.equal(width, height, 'square source icon');
    assert(offset + length <= ico.length, 'source ICO entry bounds');
    icons.push({width, height, sha256: sha(ico.subarray(offset, offset + length))});
  }
  assert.deepEqual(icons.map(x => x.width).sort((a, b) => a - b), expectedSizes);
  return {ico, icons, hashes: icons.map(x => x.sha256).sort()};
}
const source = sourceIcon();

function verifyPE(file, expectedMachine, label) {
  const buf = read(file);
  assert(buf.length > 0x40, `${label}: PE too small`);
  const pe = buf.readUInt32LE(0x3c);
  assert.equal(buf.readUInt32LE(pe), 0x4550, `${label}: PE signature`);
  const machine = buf.readUInt16LE(pe + 4);
  assert.equal(machine, expectedMachine, `${label}: PE architecture`);
  const optional = pe + 24, magic = buf.readUInt16LE(optional);
  assert([0x10b, 0x20b].includes(magic), `${label}: optional-header magic`);
  const certDirectory = optional + (magic === 0x20b ? 112 : 96) + 8 * 4;
  assert.equal(buf.readUInt32LE(certDirectory), 0, `${label}: certificate offset (unsigned)`);
  assert.equal(buf.readUInt32LE(certDirectory + 4), 0, `${label}: certificate size (unsigned)`);
  const exe = R.NtExecutable.from(buf), res = R.NtExecutableResource.from(exe);
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  assert(groups.length > 0, `${label}: embedded icon group`);
  const checked = groups.map(group => {
    const icons = group.icons.map(item => {
      const entry = res.entries.find(e => e.type === 3 && e.id === item.iconID && e.lang === group.lang);
      assert(entry, `${label}: icon resource entry`);
      return {width: item.width || 256, height: item.height || 256, sha256: sha(Buffer.from(entry.bin))};
    });
    assert.deepEqual(icons.map(x => x.width).sort((a, b) => a - b), expectedSizes, `${label}: icon sizes`);
    assert.deepEqual(icons.map(x => x.sha256).sort(), source.hashes, `${label}: embedded icon bytes`);
    return {id: group.id, lang: group.lang, icons};
  });
  const versions = R.Resource.VersionInfo.fromEntries(res.entries)
    .flatMap(v => v.getAllLanguagesForStringValues().map(lang => v.getStringValues(lang)));
  assert(versions.some(v => v.ProductName === 'SitStride'), `${label}: ProductName`);
  assert(versions.some(v => String(v.ProductVersion || '').startsWith(version)), `${label}: ProductVersion`);
  return {machine: machine.toString(16), unsigned: true, groups: checked, versions, sha256: sha(buf)};
}

function files(dir) {
  const result = [];
  function visit(current) {
    for (const ent of fs.readdirSync(current, {withFileTypes: true})) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) visit(full); else result.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  }
  visit(dir);
  return result.sort();
}
function verifyAsar(asarFile, label) {
  const appDir = path.join(root, 'app');
  const appFiles = files(appDir).map(f => `app/${f}`);
  const listed = asar.listPackage(asarFile).map(x => x.replace(/^\//, ''))
    .filter(x => !asar.statFile(asarFile, x).files).sort();
  assert.deepEqual(listed, [...appFiles, 'package.json'].sort(), `${label}: source file list`);
  for (const f of appFiles) assert.equal(sha(asar.extractFile(asarFile, f)), sha(read(f)), `${label}: ${f}`);
  const metadata = JSON.parse(asar.extractFile(asarFile, 'package.json'));
  for (const key of ['name', 'version', 'main', 'description', 'author', 'license'])
    assert.deepEqual(metadata[key], pkg[key], `${label}: package metadata ${key}`);
  return {appFilesMatched: appFiles.length, metadataMatched: true, sha256: sha(read(asarFile))};
}
function verifyUnpacked(dir, label, machine) {
  assert(exists(dir), `${label}: missing unpacked directory`);
  const asarFile = path.join(dir, 'resources/app.asar');
  const report = verifyAsar(asarFile, `${label} app.asar`);
  report.executable = verifyPE(path.join(dir, 'SitStride.exe'), machine, `${label} app`);
  return report;
}
function compareTrees(left, right, label) {
  const a = files(left), b = files(right);
  assert.deepEqual(a, b, `${label}: payload file list`);
  for (const f of a) assert.equal(sha(read(path.join(left, f))), sha(read(path.join(right, f))), `${label}: ${f}`);
  return a.length;
}
function verifyInstaller(archName, machine) {
  const unpacked = path.join(out, archName === 'x64' ? 'win-unpacked' : 'win-ia32-unpacked');
  const installer = path.join(out, `SitStride-Setup-${version}-${archName}.exe`);
  assert(exists(installer), `${archName}: missing installer`);
  const report = {app: verifyUnpacked(unpacked, `${archName} unpacked`, machine)};
  // NSIS bootstrapper is 32-bit for both targets; its embedded icon and version are checked.
  report.installer = verifyPE(installer, 0x14c, `${archName} installer`);
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), `sitstride-${version}-${archName}-`));
  try {
    execFileSync('7z', ['x', '-y', `-o${temp}`, installer], {stdio: 'pipe'});
    assert.equal(sha(read(path.join(temp, 'uninstallerIcon.ico'))), sha(source.ico), `${archName}: uninstaller ICO`);
    const uninstaller = path.join(temp, '$R0/Uninstall SitStride.exe');
    report.uninstaller = verifyPE(uninstaller, 0x14c, `${archName} uninstaller`);
    const plugin = path.join(temp, '$PLUGINSDIR');
    const archives = fs.readdirSync(plugin).filter(f => /^app-.*\.7z$/i.test(f));
    assert.equal(archives.length, 1, `${archName}: exactly one NSIS app archive`);
    const payload = path.join(temp, 'payload');
    fs.mkdirSync(payload);
    execFileSync('7z', ['x', '-y', `-o${payload}`, path.join(plugin, archives[0])], {stdio: 'pipe'});
    report.installerPayload = verifyAsar(path.join(payload, 'resources/app.asar'), `${archName} installer payload app.asar`);
    assert.equal(report.installerPayload.sha256, report.app.sha256, `${archName}: source asar bytes`);
    report.fullPayloadFilesMatched = compareTrees(payload, unpacked, `${archName}: full installer payload`);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
  return report;
}

const finalDesign = JSON.parse(read('qa/1.0.7/candidate-source-tree.json'));
for (const [file, hash] of Object.entries(finalDesign)) assert.equal(sha(read(file)), hash, `final candidate source file ${file}`);
const assets = JSON.parse(read(sourceAssetsManifest));
for (const [file, hash] of Object.entries(assets)) assert.equal(sha(read(file)), hash, `unchanged designer asset ${file}`);
assert.equal(pkg.build.win.icon, 'app/assets/icon.ico');
assert.equal(pkg.build.nsis.installerIcon, pkg.build.win.icon);
assert.equal(pkg.build.nsis.uninstallerIcon, pkg.build.win.icon);
assert.equal(pkg.build.nsis.shortcutName, 'SitStride');
assert(pkg.build.nsis.createDesktopShortcut && pkg.build.nsis.createStartMenuShortcut);
const main = read('app/main.js').toString(), html = read('app/renderer/index.html').toString();
assert(main.includes("process.platform === 'win32' ? 'icon.ico' : 'icon.png'"));
assert(main.includes("'assets', 'tray.png'"));
assert(html.includes('src="../assets/icon.png"'));
for (const svg of [read('app/assets/icon.svg').toString(), read('app/assets/tray.svg').toString()]) {
  assert(svg.includes('M76 131 L85 192 L145 192 M90 195 L86 232 M140 195 L145 232'), 'seated-chair icon geometry');
  assert(!/clock/i.test(svg), 'no clock in source icon');
}
assert(exists(preservedManifest), 'missing preserved artifact manifest');
execFileSync('sha256sum', ['-c', preservedManifest], {cwd: root, stdio: 'pipe'});
const result = {
  version, passed: false,
  sourceIcons: source.icons, assets, finalDesign,
  branding: {chairIncluded: true, clockInIcon: false, renderer: true, tray: true, installer: true, uninstaller: true,
    shortcutUsesAppExecutableIcon: true, shortcutNote: 'Build configuration and embedded target icon verified; native Windows shortcut creation untested.'},
  windows: {x64: verifyInstaller('x64', 0x8664), ia32: exists(path.join(out, `SitStride-Setup-${version}-ia32.exe`)) ? verifyInstaller('ia32', 0x14c) : {available:false, reason:'Owner retained x64-only target; no x86 build attempted for this candidate.'}},
  linux: null, preservedPreviousArtifactsUnchanged: true, nativeWindowsTested: false
};
const linuxAsar = path.join(out, 'linux-unpacked/resources/app.asar');
if (exists(linuxAsar)) result.linux = verifyAsar(linuxAsar, 'optional linux app.asar');
result.passed = true;
fs.writeFileSync(path.join(__dirname, 'package-and-icon-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
