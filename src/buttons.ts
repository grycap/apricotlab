import { ToolbarButton, Dialog } from '@jupyterlab/apputils';
import { NotebookPanel, INotebookModel } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { IDisposable } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';
import { DeploymentLogic } from './deploymentLogic';

export class ButtonExtension implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel> {

    // Everytime a Notebook is created the createNew function will run
    // NotebookPanel is the widget class for Notebook
    createNew(panel: NotebookPanel, context: DocumentRegistry.IContext<INotebookModel>): IDisposable {
        // Create the toolbar buttons
        const DeploymentButton = new ToolbarButton({
            label: 'Deployment Menu',
            onClick: () => this.openDeploymentDialog()
        });

        const ListDeploymentsButton = new ToolbarButton({
            label: 'Deployments list',
            onClick: () => this.openListDeploymentsDialog()
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

    private openDeploymentDialog(): void {
        // Create a container element for the dialog content
        const dialogContent = document.createElement('div');

        // Call deployChooseProvider to append buttons to dialogContent
        DeploymentLogic.deployChooseProvider(dialogContent);

        // Create a widget from the dialog content
        const contentWidget = new Widget({ node: dialogContent })

        const dialog = new Dialog({
            title: 'Deploy Infrastructure',
            body: contentWidget,
            buttons: [Dialog.cancelButton(), Dialog.okButton()]
        });

        // Handle form submission
        dialog.launch().then(result => {
            // Logic to handle form submission
            console.log('Form submitted');
        });

    }


    private openListDeploymentsDialog(): void {
        const dialog = new Dialog({
            title: 'Deployments List',
            body: '', // Create and append table elements here
        });
        dialog.launch();
    }
}
