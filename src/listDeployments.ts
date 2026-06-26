import { Dialog, Notification } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import {
  getIMClientPath,
  createButton,
  getAuthFilePath,
  executeKernelCommand,
  readInfrastructuresList,
  removeInfrastructureFromList
} from './utils';

interface IInfrastructure {
  IMuser: string;
  IMpass: string;
  accessToken: string;
  name: string;
  infrastructureID: string;
  id: string;
  type: string;
  host: string;
  tenant: string;
  user?: string;
  pass?: string;
  authVersion?: string;
  domain: string;
  vo?: string;
  custom: string;
}

const imEndpoint = 'https://im.egi.eu/im';

async function openListDeploymentsDialog(): Promise<void> {
  try {
    // Create a loader container
    const loaderContainer = document.createElement('div');
    loaderContainer.classList.add('loader-container');

    const loader = document.createElement('div');
    loader.classList.add('loader');

    loaderContainer.appendChild(loader);

    // Create the dialog content
    const dialogContent = document.createElement('div');
    dialogContent.classList.add('apricot-dialog');
    dialogContent.appendChild(loaderContainer);

    const contentWidget = new Widget({ node: dialogContent });
    const dialog = new Dialog({
      title: 'Deployments List',
      body: contentWidget,
      buttons: [Dialog.cancelButton()]
    });
    dialog.addClass('apricot-dialog');

    dialog.launch();

    const table = createTable();
    await populateTable(table);

    dialogContent.removeChild(loaderContainer);
    dialogContent.appendChild(table);
  } catch (error) {
    console.error('Error loading infrastructures list:', error);
    Notification.error(
      'Error loading infrastructures list. Check the console for more details.',
      {
        autoClose: 5000
      }
    );
  }
}

function createTable(): HTMLTableElement {
  const table = document.createElement('table');
  table.classList.add('deployments-table');

  // Create the header row
  const headers = ['Name', 'ID', 'IP', 'State', 'Action'];
  const headerRow = table.insertRow();
  headers.map(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });

  return table;
}

async function deleteButton(
  infrastructure: IInfrastructure,
  row: HTMLTableRowElement
): Promise<HTMLButtonElement> {
  // Create a Delete button inside the action column
  const deleteButton = createButton('Delete', async () => {
    const infrastructureId = infrastructure.infrastructureID;

    // Create a loader element
    const loader = document.createElement('div');
    loader.className = 'mini-loader';
    deleteButton.textContent = '';

    try {
      const cmdDeploy = await destroyInfrastructure(infrastructureId);

      deleteButton.appendChild(loader);

      const outputText = await executeKernelCommand(cmdDeploy);

      if (outputText && outputText.includes('successfully destroyed')) {
        row.remove();

        Notification.success(
          `Infrastructure ${infrastructureId} successfully destroyed.`,
          {
            autoClose: 5000
          }
        );
        console.log(outputText);

        await removeInfrastructureFromList(infrastructureId);
      } else {
        Notification.error(
          'Error destroying infrastructure. Check the console for more details.',
          {
            autoClose: 5000
          }
        );
        console.error('Error destroying infrastructure:', outputText);
      }
    } catch (error) {
      Notification.error(
        'Error destroying infrastructure. Check the console for more details.',
        {
          autoClose: 5000
        }
      );

      console.error('Error destroying infrastructure:', error);
    } finally {
      // Ensure that the loader is always removed after the try/catch block
      deleteButton.removeChild(loader);
      deleteButton.textContent = 'Delete';
    }
  });

  return deleteButton;
}

async function populateTable(table: HTMLTableElement): Promise<void> {
  let infrastructures: IInfrastructure[] = [];
  try {
    const data = await readInfrastructuresList();
    infrastructures = data.infrastructures;
  } catch (error) {
    console.error(
      'Error reading or parsing infrastructuresList.json:',
      error
    );
    Notification.error(
      'Error reading or parsing infrastructuresList.json. Check the console for more details.',
      {
        autoClose: 5000
      }
    );
    throw new Error('Error parsing JSON data');
  }

  // Populate the table rows and fetch IP and state for each infrastructure
  await Promise.all(
    infrastructures.map(async infrastructure => {
      const row = table.insertRow();
      const nameCell = row.insertCell();
      nameCell.textContent = infrastructure.name;
      const idCell = row.insertCell();
      idCell.textContent = infrastructure.infrastructureID;
      const ipCell = row.insertCell();
      const stateCell = row.insertCell();
      const actionCell = row.insertCell();

      try {
        const [state, ip] = await Promise.all([
          fetchInfrastructureData(infrastructure, 'state'),
          fetchInfrastructureData(infrastructure, 'ip')
        ]);

        // Update state and IP cells
        stateCell.textContent = state;
        ipCell.textContent = ip;
      } catch (error) {
        console.error(
          `Error fetching data for infrastructure ${infrastructure.name}:`,
          error
        );
        stateCell.textContent = 'Error';
        ipCell.textContent = 'Error';
      }

      const deleteBtn = await deleteButton(infrastructure, row);
      actionCell.appendChild(deleteBtn);
    })
  );
}

async function getInfrastructureInfo(
  infrastructure: IInfrastructure,
  dataType: 'state' | 'ip'
): Promise<string> {
  const infrastructureID = infrastructure.infrastructureID;

  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  const imArgs =
    dataType === 'state'
      ? ['getstate', infrastructureID]
      : ['getvminfo', infrastructureID, '0', 'net_interface.1.ip'];

  const cmd = `
from pathlib import Path
import subprocess

auth_file = Path.cwd() / ${JSON.stringify(authFilePath)}
cmd = [
    "python3",
    ${JSON.stringify(imClientPath)},
    *${JSON.stringify(imArgs)},
    "-r",
    ${JSON.stringify(imEndpoint)},
    "-a",
    str(auth_file),
]
result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout)
if result.returncode != 0:
    raise RuntimeError(result.stdout)
              `;

  console.log(`Get ${dataType} command: `, cmd);
  return cmd;
}

async function fetchInfrastructureData(
  infrastructure: IInfrastructure,
  dataType: 'state' | 'ip'
): Promise<string> {
  try {
    const cmd = await getInfrastructureInfo(infrastructure, dataType);
    const outputData = await executeKernelCommand(cmd);

    if (!outputData || outputData.trim() === '') {
      return 'No Output';
    }

    console.log(`Received output for ${dataType}:`, outputData);

    let result: string;

    if (outputData.toLowerCase().includes('error')) {
      result = outputData;
    } else {
      if (dataType === 'state') {
        const stateWords = outputData.trim().split(' ');
        const stateIndex = stateWords.indexOf('state:');
        result =
          stateIndex !== -1 && stateIndex < stateWords.length - 1
            ? stateWords[stateIndex + 1].trim()
            : 'Error';
      } else {
        const ipWords = outputData.trim().split(' ');
        result = ipWords[ipWords.length - 1] || 'Error';
      }
    }

    return result;
  } catch (error) {
    console.error(`Error fetching ${dataType}:`, error);
    return 'Error';
  }
}

async function destroyInfrastructure(
  infrastructureID: string
): Promise<string> {
  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  const cmd = `
from pathlib import Path
import subprocess

auth_file = Path.cwd() / ${JSON.stringify(authFilePath)}
cmd = [
    "python3",
    ${JSON.stringify(imClientPath)},
    "destroy",
    ${JSON.stringify(infrastructureID)},
    "-a",
    str(auth_file),
    "-r",
    ${JSON.stringify(imEndpoint)},
]
result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout)
if result.returncode != 0:
    raise RuntimeError(result.stdout)
          `;

  console.log(cmd);
  return cmd;
}

export { openListDeploymentsDialog };
