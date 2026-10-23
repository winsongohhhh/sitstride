from pathlib import Path
import hashlib, json, shutil, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / 'qa/1.0.7'
DEST = ROOT / 'deliverables'
VERSION = '1.0.7'
PREFIX = f'SitStride-Source-{VERSION}'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert json.loads((ROOT/'package.json').read_text())['version'] == VERSION
verification = json.loads((QA/'package-and-icon-verification.json').read_text())
assert verification['passed']
for name in ['runtime-verification.json', 'renderer-results.json', 'compact-design-results.json', 'copy-results.json', 'interactions-results.json', 'motion-accessibility-results.json']:
    assert json.loads((QA/name).read_text())['passed'], name
unit = (QA/'unit-tests.log').read_text()
assert 'tests 21' in unit and 'pass 21' in unit and 'fail 0' in unit
subprocess.run(['sha256sum', '-c', str(QA/'preserved-previous.sha256')], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
files = [ROOT/n for n in ['package.json', 'package-lock.json', 'README.md', 'qa/1.0.5/designer-assets.json']]
for folder in ['app', 'tests', 'original', 'qa/1.0.7']:
    files += sorted(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix not in ['.pyc', '.tmp'] and p.name not in ['candidate-inputs.sha256', 'source-zip-tests.log', 'source-package.json', 'source-package.log'])
assert len(files) == len(set(files))
assert all(p.stat().st_size > 0 for p in files)
inputs = QA/'candidate-inputs.sha256'
inputs.write_text(''.join(f'{sha(p)}  {p.relative_to(ROOT).as_posix()}\n' for p in sorted(files)))
files.append(inputs)
archive = DEST/f'{PREFIX}.zip'
installers = [DEST/f'SitStride-Setup-{VERSION}-{arch}.exe' for arch in ['x64']]
manifest = DEST/f'SitStride-SHA256SUMS-{VERSION}.txt'
report = DEST/f'SitStride-Validation-{VERSION}.json'
for p in [archive, *installers, manifest, report]:
    assert not p.exists(), f'Refusing to overwrite {p}'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in files:
        z.write(p, f'{PREFIX}/{p.relative_to(ROOT).as_posix()}')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for p in files:
        assert z.read(f'{PREFIX}/{p.relative_to(ROOT).as_posix()}') == p.read_bytes()
    with tempfile.TemporaryDirectory(prefix='sitstride-source-107-') as temp:
        z.extractall(temp)
        source = Path(temp)/PREFIX
        proc = subprocess.run(['npm','test'], cwd=source, capture_output=True, text=True)
        (QA/'source-zip-tests.log').write_text(proc.stdout+proc.stderr)
        assert proc.returncode == 0 and 'pass 21' in proc.stdout and 'fail 0' in proc.stdout
        subprocess.run(['sha256sum','-c','qa/1.0.7/candidate-inputs.sha256'], cwd=source, check=True, stdout=subprocess.DEVNULL)
for p in installers:
    shutil.copy2(ROOT/'release/1.0.7'/p.name, p)
    assert sha(p) == sha(ROOT/'release/1.0.7'/p.name)
result = {
    'version': VERSION, 'passed': True,
    'closeBehavior': {'X': 'Shows Close SitStride? choice', 'keep': 'Keep in system tray: hides while timer and reminders continue', 'quit': 'Quit SitStride: exits and stops reminders', 'minimize': 'Silently hides to tray, no prompt or pause', 'escape': 'Dismisses close dialog without hiding or quitting'},
    'preserved': ['60-minute sit / 5-minute stand defaults', '250-step sitting-end reminder', 'tray and settings behavior', 'seated mascot + chair icon without clock', 'all previously present deliverables and 1.0.6 release/QA files byte-for-byte'],
    'windowsArchitectures': {'x64': '64-bit Windows 10/11', 'ia32': 'Not available: Electron 45 removed Windows ia32 builds'},
    'x86Viable': False, 'x86Reason': 'Owner retained x64-only policy; no x86 build attempted for 1.0.7.', 'x86PolicySource': 'https://www.electronjs.org/docs/latest/breaking-changes#removed-windows-32-bit-ia32-and-linux-32-bit-arm-armv7l-support', 'separateArchitectureInstallers': False,
    'unsigned': True, 'nativeWindowsTested': False,
    'unitTestsPassed': 21, 'relocatedSourceTestsPassed': 21, 'extractedSourceTestsPassed': 21,
    'rendererIntegrationPassed': True, 'savedAndOSReducedMotionMatrixPassed': True, 'motionCombinationsTested':4, 'reducedTransition':{'entryMs':120,'exitMs':100,'properties':['opacity'],'spatialTransform':'none','signals':'saved app preference OR OS preference; live changes supported'}, 'dialogTargetMinimumPx':44, 'targetScope':'Close-dialog choices only; compact legacy controls unchanged', 'accessibleInteractionChecksPassed': True, 'savedAndOSReducedMotionMatrixPassed': True, 'dialogTargetMinimumPx':44, 'targetScope':'Close-dialog choices only; compact legacy controls unchanged', 'rapidCloseReopenContinuityPassed': True, 'reducedMotionOpacityOnlyTransitionsPassed': True, 'compactLayoutAndSingleLineCopyPassed': True,
    'packagedLinuxRuntimePassed': True, 'realPreloadIPCPassed': True,
    'installerPayloadAndEmbeddedBrandingPassed': True,
    'sourceZipFilesVerified': len(files),
    'previousArtifactsUnchanged': True,
    'limitations': ['Native Windows installation/uninstallation, tray appearance, startup registration, shortcut creation, sound, SmartScreen, DPI and multi-monitor behavior remain untested.', 'The x64 installer is an unsigned QA candidate; unknown-publisher/SmartScreen warnings are possible.', 'Linux runtime integration is not a native Windows runtime test. No native ARM64 build is included.'],
    'evidenceDirectory': str(QA),
    'evidence': {name: str(QA/name) for name in ['unit-tests.log', 'portable-tests.log', 'renderer-results.json', 'interactions-results.json', 'compact-design-results.json', 'copy-results.json', 'runtime-verification.json', 'package-and-icon-verification.json', 'source-zip-tests.log', 'preservation-check.log', 'motion-accessibility-results.json', 'candidate-source-tree.json']},
    'artifacts': {p.name: {'path':str(p), 'bytes':p.stat().st_size, 'sha256':sha(p)} for p in [*installers, archive]}
}
report.write_text(json.dumps(result, indent=2)+'\n')
manifest.write_text(''.join(f'{sha(p)}  {p.name}\n' for p in [*installers, archive, report]))
subprocess.run(['sha256sum','-c',manifest.name], cwd=DEST, check=True)
subprocess.run(['sha256sum','-c',str(QA/'preserved-previous.sha256')], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
(QA/'source-package.json').write_text(json.dumps({'passed':True,'source':str(archive),'filesVerified':len(files),'extractedTestsPassed':21}, indent=2)+'\n')
print(json.dumps(result,indent=2))
