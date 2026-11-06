import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/archivo/wdth-italic.css';
import './styles/main.css';
import { App } from './ui/app';

import { settings } from './settings';
document.documentElement.dataset.surface = settings.get().surface;
new App(document.getElementById('app')!);
