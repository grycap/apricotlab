import { ToolbarButton } from '@jupyterlab/apputils';
import { NotebookPanel, INotebookModel } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { IDisposable } from '@lumino/disposable';
import { DeploymentLogic } from './deploymentMenu';
import { ListDeploymentsLogic } from './listDeployments';

export class ButtonExtension implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel> {

    createNew(panel: NotebookPanel, context: DocumentRegistry.IContext<INotebookModel>): IDisposable {
        // Create the toolbar buttons
        const DeploymentButton = new ToolbarButton({
            label: 'Deployment Menu',
            onClick: () => DeploymentLogic.openDeploymentDialog()
        });

        const ListDeploymentsButton = new ToolbarButton({
            label: 'Deployments list',
            onClick: () => ListDeploymentsLogic.openListDeploymentsDialog()
        });

        // Insert buttons into the toolbar
        panel.toolbar.insertItem(10, 'open-list-deployments-dialog', ListDeploymentsButton);
        panel.toolbar.insertItem(11, 'open-deployment-dialog', DeploymentButton);

        return {
            dispose: () => {
                DeploymentButton.dispose();
                ListDeploymentsButton.dispose();
            },
            isDisposed: false
        };
    }

}