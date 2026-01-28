import { ToolbarButton } from '@jupyterlab/apputils';
import { NotebookPanel, INotebookModel } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { IDisposable } from '@lumino/disposable';
import { openDeploymentDialog } from './deploymentMenu';
import { openListDeploymentsDialog } from './listDeployments';
import { treeViewIcon, listIcon } from '@jupyterlab/ui-components'; // kernelIcon

export class ButtonExtension implements DocumentRegistry.IWidgetExtension<
  NotebookPanel,
  INotebookModel
> {
  createNew(
    panel: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {
    // Create the toolbar buttons
    const deploymentButton = new ToolbarButton({
      label: ' Deployment menu',
      onClick: () => openDeploymentDialog(),
      icon: treeViewIcon // kernelIcon
    });

    const listDeploymentsButton = new ToolbarButton({
      label: ' Deployments list',
      onClick: () => openListDeploymentsDialog(),
      icon: listIcon
    });

    // Insert buttons into the toolbar
    const deploymentButtonIndex = 10;
    const listDeploymentsButtonIndex = 11;

    panel.toolbar.insertItem(
      deploymentButtonIndex,
      'open-list-deployments-dialog',
      listDeploymentsButton
    );
    panel.toolbar.insertItem(
      listDeploymentsButtonIndex,
      'open-deployment-dialog',
      deploymentButton
    );

    return {
      dispose: () => {
        deploymentButton.dispose();
        listDeploymentsButton.dispose();
      },
      isDisposed: false
    };
  }
}
