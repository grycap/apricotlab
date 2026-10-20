import { describe, expect, it, jest } from '@jest/globals';

const notificationSuccess = jest.fn();
const addWidgetExtension = jest.fn();
const widgetAddClass = jest.fn();

jest.mock('@jupyterlab/apputils', () => ({
  DOMUtils: { createDomID: jest.fn(() => 'apricot-test-id') },
  Notification: { success: notificationSuccess }
}));
jest.mock('@lumino/widgets', () => ({
  Widget: jest.fn().mockImplementation((options: unknown) => {
    const { node } = options as { node: HTMLElement };
    return {
      addClass: widgetAddClass,
      id: '',
      node
    };
  })
}));
jest.mock('../../src/buttons', () => ({
  ButtonExtension: jest.fn().mockImplementation(() => ({ marker: 'buttons' }))
}));

import plugin from '../../src/index';

describe('APRICOT JupyterLab plugin', () => {
  it('adds its top-area branding and notebook toolbar extension', () => {
    const shellAdd = jest.fn();
    const app = {
      docRegistry: { addWidgetExtension },
      shell: { add: shellAdd }
    } as any;

    (plugin.activate as any)(app);

    expect(notificationSuccess).toHaveBeenCalledWith(
      'JupyterLab extension APRICOTLab is activated!',
      { autoClose: 5000 }
    );
    expect(shellAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'apricot-test-id',
        node: expect.objectContaining({
          className: 'apricot-top-area',
          textContent: 'APRICOTLab'
        })
      }),
      'top',
      { rank: 1000 }
    );
    expect(widgetAddClass).toHaveBeenCalledWith('apricot-top-area');
    expect(addWidgetExtension).toHaveBeenCalledWith(
      'Notebook',
      expect.objectContaining({ marker: 'buttons' })
    );
  });
});
