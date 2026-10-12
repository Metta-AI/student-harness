const path = require('node:path');

(async () => {
  const { packager } = await import('@electron/packager');
  const outputs = await packager({
    dir: path.join(__dirname, '..'),
    out: path.join(__dirname, '..', 'dist'),
    name: 'Softmax IDE',
    executableName: 'Softmax IDE',
    icon: path.join(__dirname, '..', 'build', 'icon'),
    appBundleId: 'com.softmax.desktop.prototype',
    appCategoryType: 'public.app-category.education',
    platform: 'darwin',
    arch: process.env.SOFTMAX_IDE_ARCH ? process.env.SOFTMAX_IDE_ARCH.split(',') : ['arm64', 'x64'],
    appVersion: require('../package.json').version,
    asar: true,
    overwrite: true,
    ignore: [/^\/dist(?:\/|$)/, /^\/node_modules(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/README\.md$/],
    extendInfo: {
      NSMicrophoneUsageDescription: 'Talk with Preston and record replay coaching.',
      NSCameraUsageDescription: 'Share your camera with Preston when you choose to.',
      NSAudioCaptureUsageDescription: 'Record game audio when you choose to share it.',
    },
  });
  console.log(`Prototype packaged at:\n${outputs.join('\n')}\nThis local development build is not signed or notarized.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
