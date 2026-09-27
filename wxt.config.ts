import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'X to Markdown',
    description: 'Save X Articles as clean Markdown in one click.',
    permissions: ['activeTab', 'downloads', 'clipboardWrite'],
    host_permissions: ['https://api.fxtwitter.com/*'],
    minimum_chrome_version: '109',
    action: { default_title: 'X to Markdown' },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
