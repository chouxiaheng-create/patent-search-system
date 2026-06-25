// Compile script for patent search system architecture diagram
const path = require('path');

// pptxgenjs is installed globally; require directly from global node_modules
const pptxgen = require('C:/Users/12787/AppData/Roaming/npm/node_modules/pptxgenjs');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = 'Patent Search System';
pres.title = 'Patent Search Agent System Architecture';

// Theme (project-specific palette + required 5 keys)
const theme = {
  // Mandatory 5 keys
  primary:   '0D47A1',
  secondary: '424242',
  accent:    'EF6C00',
  light:     'E3F2FD',
  bg:        'F5F7FA',
  // Extended (project palette)
  blue_dark:   '0D47A1',
  blue_mid:    '1565C0',
  blue_light:  'E3F2FD',
  orange_dark: 'E65100',
  orange_mid:  'EF6C00',
  orange_light:'FFE0B2',
  green_dark:  '1B5E20',
  green_mid:   '2E7D32',
  green_light: 'E8F5E9',
  gray_text:   '424242',
  gray_sub:    '757575',
  gray_line:   'BDBDBD',
  white:       'FFFFFF'
};

require('./slide-01.js').createSlide(pres, theme);

const outFile = path.join(__dirname, '..', 'output', 'system-architecture-v2.1.pptx');
pres.writeFile({ fileName: outFile }).then(() => {
  console.log('Saved: ' + outFile);
});
