import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the apricot extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'apricot:plugin',
  description: 'A ri cot.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension apricot is activated!');
  }
};

export default plugin;
