import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { DOMUtils } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { ButtonExtension } from './buttons';

/**
 * Initialization data for the apricot extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'apricot:plugin',
  description:
    'Advanced Platform for Reproducible Infrastructure in the Cloud via Open Tools.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension APRICOT is activated!');

    // Create the HTML content of the widget
    const node = document.createElement('div');
    node.className = 'apricot-top-area';
    node.innerHTML = 'APRICOT';

    // Create the widget
    const widget = new Widget({ node });
    widget.id = DOMUtils.createDomID(); // Widgets must have an unique identifier
    widget.addClass('apricot-top-area');

    // Add the widget to the top area of JupyterLab interface
    app.shell.add(widget, 'top', { rank: 1000 });

    const buttonExtension = new ButtonExtension();
    app.docRegistry.addWidgetExtension('Notebook', buttonExtension);
  }
};

export default plugin;
