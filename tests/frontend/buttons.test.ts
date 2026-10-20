import { describe, expect, it, jest } from '@jest/globals';

const openDeploymentDialog = jest.fn();
const openListDeploymentsDialog = jest.fn();

jest.mock('../../src/deploymentMenu', () => ({ openDeploymentDialog }));
jest.mock('../../src/listDeployments', () => ({ openListDeploymentsDialog }));
jest.mock('@jupyterlab/ui-components', () => ({
  listIcon: { name: 'list' },
  treeViewIcon: { name: 'tree' }
}));
jest.mock('@jupyterlab/apputils', () => ({
  ToolbarButton: jest.fn().mockImplementation(options => ({
    dispose: jest.fn(),
    options
  }))
}));

import { ToolbarButton } from '@jupyterlab/apputils';
import { ButtonExtension } from '../../src/buttons';

interface IToolbarButtonOptions {
  label: string;
  onClick: () => void;
}

describe('ButtonExtension', () => {
  it('adds both APRICOT buttons and connects their actions', () => {
    const insertItem = jest.fn();
    const panel = { toolbar: { insertItem } } as any;

    const disposable = new ButtonExtension().createNew(panel, {} as any);

    expect(insertItem).toHaveBeenNthCalledWith(
      1,
      10,
      'open-list-deployments-dialog',
      expect.any(Object)
    );
    expect(insertItem).toHaveBeenNthCalledWith(
      2,
      11,
      'open-deployment-dialog',
      expect.any(Object)
    );

    const toolbarButton = ToolbarButton as unknown as jest.Mock<any>;
    const listOptions = toolbarButton.mock.calls[1][0] as IToolbarButtonOptions;
    const deploymentOptions = toolbarButton.mock
      .calls[0][0] as IToolbarButtonOptions;
    expect(listOptions.label).toBe(' Deployments list');
    expect(deploymentOptions.label).toBe(' Deployment menu');

    listOptions.onClick();
    deploymentOptions.onClick();
    expect(openListDeploymentsDialog).toHaveBeenCalledTimes(1);
    expect(openDeploymentDialog).toHaveBeenCalledTimes(1);

    disposable.dispose();
    const deploymentButton = toolbarButton.mock.results[0].value as {
      dispose: jest.Mock;
    };
    const listButton = toolbarButton.mock.results[1].value as {
      dispose: jest.Mock;
    };
    expect(deploymentButton.dispose).toHaveBeenCalled();
    expect(listButton.dispose).toHaveBeenCalled();
  });
});
