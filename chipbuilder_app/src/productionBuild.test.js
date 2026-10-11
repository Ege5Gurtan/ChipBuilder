const { execFileSync } = require('child_process');

test('production build compiles', () => {
  const buildScript = require.resolve('react-scripts/scripts/build');
  execFileSync(process.execPath, [buildScript], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
}, 180000);
