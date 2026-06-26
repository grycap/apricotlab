import * as jsyaml from 'js-yaml';

import { ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import { Dialog, Notification } from '@jupyterlab/apputils';

import {
  appendInfrastructureToList,
  executeKernelCommand,
  getIMClientPath,
  getDeployedTemplatePath,
  getAuthFilePath,
  getAccessTokenFromShareManager,
  persistAuthFile,
  writeTextFile,
  getStateFilePath,
  createButton
} from './utils';

interface IDeployInfo {
  accessToken: any;
  accessTokenSource: 'auto' | 'manual';
  recipe: string;
  id: string;
  deploymentType: string;
  host: string;
  tenant: string;
  username: string;
  password: string;
  infName: string;
  authVersion: string;
  domain: string;
  vo: string;
  custom: string;
  image: string;

  inputs: {
    [key: string]: string;
  };

  childs: string[];
}

interface IRecipe {
  name: string;
  childs: string[];
}

interface ITemplateInput {
  type: string;
  description: string;
  default: any;
  value?: any;
}

type UserInput = {
  name: string;
  type: string;
  inputs: {
    [key: string]: {
      type: string;
      description: string;
      default: any;
      value: any;
    };
  };
  nodeTemplates: any;
  outputs: any;
};

interface IInfrastructureData {
  accessToken: string;
  accessTokenSource: 'auto' | 'manual';
  name: string;
  infrastructureID: string;
  id: string;
  type: string;
  host: string;
  tenant: string;
  user: string;
  pass: string;
  authVersion: string;
  domain: string;
  vo: string;
  custom: string;
}

const deployInfo: IDeployInfo = {
  accessToken: '',
  accessTokenSource: 'manual',
  recipe: '',
  id: '',
  deploymentType: '',
  host: '',
  tenant: '',
  username: '',
  password: '',
  infName: 'infra-name',
  authVersion: '',
  domain: '',
  vo: '',
  custom: 'false',

  inputs: {}, // holds all fe_* and wn_* key-value pairs
  image: '',

  childs: []
};

const recipes: IRecipe[] = [
  {
    name: 'Simple node disk',
    childs: []
  },
  {
    name: 'Slurm',
    childs: []
  }
];

const providers = {
  EGI: { id: 'egi', deploymentType: 'EGI' },
  OpenStack: { id: 'ost', deploymentType: 'OpenStack' },
  OpenNebula: { id: 'one', deploymentType: 'OpenNebula' },
  EC2: { id: 'ec2', deploymentType: 'EC2' }
};

const excludedKeys = new Set([
  'instance_type',
  'swap_size',
  'storage_size',
  'mount_path',
  'gpu_vendor',
  'gpu_model',
  'ports',
  'fe_instance_type',
  'fe_disk_size',
  'fe_volume_id',
  'fe_kube_nvidia_support',
  'fe_mount_path',
  'fe_ports',
  'wn_gpu_vendor',
  'wn_gpu_model',
  'wn_instance_type',
  'wn_disk_size',
  'wn_kube_nvidia_support',
  'wn_mount_path'
]);

const resetDeployInfo = () => {
  deployInfo.infName = '';
  deployInfo.id = '';
  deployInfo.deploymentType = '';
  deployInfo.host = '';
  deployInfo.tenant = '';
  deployInfo.username = '';
  deployInfo.password = '';
  deployInfo.authVersion = '';
  deployInfo.domain = '';
  deployInfo.vo = '';
  deployInfo.accessToken = '';
  deployInfo.accessTokenSource = 'manual';
};

const footerButtonContainer = document.createElement('div');
footerButtonContainer.className = 'footer-button-container';

let imageOptions: { uri: string; name: string }[] = [];

let deploying = false; // Flag to prevent multiple deployments at the same time

const imEndpoint = 'https://im.egi.eu/im';

//*****************//
//* Aux functions *//
//*****************//

async function openDeploymentDialog(): Promise<void> {
  const dialogContent = document.createElement('div');
  dialogContent.classList.add('apricot-dialog');

  deployRecipeType(dialogContent);

  const contentWidget = new Widget({ node: dialogContent });

  const dialog = new Dialog({
    title: 'Deploy Infrastructure',
    body: contentWidget,
    buttons: [Dialog.cancelButton()]
  });
  dialog.addClass('apricot-dialog');

  // Prevent the use of the Enter button, except in text areas
  (dialog as any)._evtKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;

    const isTextArea = target && target.tagName === 'TEXTAREA';

    // Allow Enter in textarea, block everywhere else
    if ((event.key === 'Enter' || event.key === 'Escape') && !isTextArea) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  dialog.launch();
}

const addFormInput = (
  form: HTMLFormElement,
  labelText: string,
  inputId: string,
  value: string = '',
  type: string = 'text',
  defaultValue?: string,
  name?: string,
  placeholder?: string
): HTMLInputElement => {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = inputId;
  form.appendChild(label);

  const input = document.createElement('input');
  input.type = type;
  input.id = inputId;
  input.name = name || inputId; // fallback to id
  input.value = value || defaultValue || '';
  input.required = true;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  input.classList.add('jp-InputArea-editor', 'cm-editor');

  form.appendChild(input);

  return input;
};

function getInputValue(inputId: string): string {
  const input = document.getElementById(inputId) as HTMLInputElement;
  return input?.value || '';
}

function detectRecipeFormat(content: string): 'radl' | 'yaml' | 'json' {
  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'json';
  }
  if (trimmed.includes('tosca_definitions_version')) {
    return 'yaml';
  }
  return 'radl';
}

function appendVmImagesTitle(container: HTMLElement): void {
  const title = document.createElement('p');
  title.textContent = 'VM Images';
  title.classList.add('form-instructions');
  container.appendChild(title);
}

async function createImagesDropdown(
  output: string | undefined,
  dropdownContainer: HTMLElement
) {
  if (!output) {
    console.log('Getting OS images...');
    return;
  }

  // Check if the output contains "error" in the message
  if (output.toLowerCase().includes('error')) {
    console.error(output);
    Notification.error(
      'No OS images found. Bad provider credentials or expired token.',
      {
        autoClose: 5000
      }
    );
  }

  // Find the first occurrence of '[' and get the substring from there
  const jsonStartIndex = output.indexOf('[');
  const jsonEndIndex = output.lastIndexOf(']') + 1;
  if (jsonStartIndex === -1 || jsonEndIndex === -1) {
    console.error(
      'No OS images found. Check provider credentials or valid access token.'
    );
    return;
  }

  const jsonOutput = output.substring(jsonStartIndex).trim();

  try {
    const images: { uri: string; name: string }[] = JSON.parse(jsonOutput);
    imageOptions = images;
    // console.log('Parsed images:', images);

    // Clear the dropdown container before appending new content
    dropdownContainer.innerHTML = '';
    appendVmImagesTitle(dropdownContainer);

    const label = document.createElement('label');
    label.textContent = 'Image:';
    label.classList.add('images-label');
    dropdownContainer.appendChild(label);

    // Create dropdown menu with image options
    const select = document.createElement('select');
    select.id = 'imageDropdown';
    select.classList.add('dropdown');
    imageOptions.forEach(image => {
      const option = document.createElement('option');
      option.value = image.uri;
      option.textContent = image.name;
      select.appendChild(option);
    });

    dropdownContainer.appendChild(select);
  } catch (error) {
    console.error('Error getting OS images:', error);
  }
}

export async function mergeTOSCARecipes(
  parsedConstantTemplate: any,
  userInputs: UserInput[] | undefined,
  nodeTemplates: any[] | undefined,
  outputs: any[] | undefined
): Promise<any> {
  try {
    // Deep clone to avoid mutating original
    const mergedTemplate = JSON.parse(JSON.stringify(parsedConstantTemplate));

    // Ensure topology_template exists
    if (!mergedTemplate.topology_template) {
      mergedTemplate.topology_template = {};
    }

    // Initialize required sections if missing
    for (const key of ['inputs', 'node_templates', 'outputs']) {
      if (!mergedTemplate.topology_template[key]) {
        mergedTemplate.topology_template[key] = {};
      }
    }

    // Handle user inputs
    if (userInputs && userInputs.length > 0) {
      const populatedTemplates = await Promise.all(userInputs);

      for (const template of populatedTemplates) {
        if (template && template.inputs) {
          for (const [inputName, input] of Object.entries(template.inputs)) {
            if (typeof input === 'object' && input !== null) {
              const inputTyped = input as ITemplateInput;

              // If input already exists, update only the default value
              if (inputName in mergedTemplate.topology_template.inputs) {
                // Preserve original input structure, only update 'default' field
                mergedTemplate.topology_template.inputs[inputName] = {
                  ...mergedTemplate.topology_template.inputs[inputName],
                  default: inputTyped.default
                };
              } else {
                // If it's a new input, add it as-is
                mergedTemplate.topology_template.inputs[inputName] = input;
              }
            }
          }
        }

        // Merge node_templates
        if (template.nodeTemplates) {
          Object.entries(template.nodeTemplates).forEach(
            ([nodeTemplateName, nodeTemplate]) => {
              mergedTemplate.topology_template.node_templates[
                nodeTemplateName
              ] = nodeTemplate;
            }
          );
        }

        // Merge outputs
        if (template.outputs) {
          Object.entries(template.outputs).forEach(([outputName, output]) => {
            mergedTemplate.topology_template.outputs[outputName] = output;
          });
        }
      }
    }

    // Inject image field into os.properties of each node template
    if (typeof deployInfo !== 'undefined' && deployInfo.image) {
      const imageValue = deployInfo.image;
      console.log('Injecting image into node_templates:', imageValue);

      const nodeTemplates = mergedTemplate.topology_template.node_templates;
      for (const nodeTemplate of Object.values(nodeTemplates) as any[]) {
        if (
          nodeTemplate.capabilities && // Check if capabilities exist
          nodeTemplate.capabilities.os && // Check if os capability exists
          nodeTemplate.capabilities.os.properties && // Check if os.properties exists
          typeof nodeTemplate.capabilities.os.properties === 'object'
        ) {
          nodeTemplate.capabilities.os.properties.image = imageValue;
        }
      }
    }

    return mergedTemplate;
  } catch (error) {
    console.error('Error merging TOSCA recipes:', error);
    return JSON.parse(JSON.stringify(parsedConstantTemplate)); // Fallback to original
  }
}

function getMainRecipeFileName(recipeName: string): string {
  const normalized = recipeName.trim().toLowerCase();

  const mainRecipeMap: Record<string, string> = {
    'simple node disk': 'simple-node-disk.yaml',
    slurm: 'slurm_cluster.yaml'
  };

  return mainRecipeMap[normalized] ?? normalized.replace(/\s+/g, '_') + '.yaml';
}

async function loadRecipeYaml(recipeName: string): Promise<string> {
  const recipeFileName = getMainRecipeFileName(recipeName);
  const settings = ServerConnection.makeSettings();
  const baseUrl = settings.baseUrl.endsWith('/')
    ? settings.baseUrl
    : `${settings.baseUrl}/`;
  const recipeUrl = `${baseUrl}lab/extensions/apricot/resources/deployable_templates/${encodeURIComponent(
    recipeFileName
  )}`;

  try {
    const response = await ServerConnection.makeRequest(
      recipeUrl,
      { method: 'GET' },
      settings
    );

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (extensionError) {
    console.error(
      `Failed to load recipe template '${recipeFileName}' from extension URL '${recipeUrl}'.`,
      extensionError
    );
    throw extensionError;
  }
}

async function loadRecipeTemplate(recipeName: string): Promise<any> {
  const yamlContent = await loadRecipeYaml(recipeName);
  return jsyaml.load(yamlContent);
}

async function createChildsForm(
  childName: string,
  index: number,
  deployDialog: HTMLElement,
  buttonsContainer: HTMLElement
) {
  const yamlData: any = await loadRecipeTemplate(childName);
  const metadata = yamlData.metadata;
  const templateName = metadata.template_name;
  const inputs = yamlData.topology_template.inputs;
  const nodeTemplates = yamlData.topology_template.node_templates;
  const outputs = yamlData.topology_template.outputs;

  // Create button for each child
  const appButton = document.createElement('button');
  appButton.className = 'jp-Button child-buttons';
  appButton.textContent = templateName;

  appButton.addEventListener('click', event => {
    event.preventDefault();
    Array.from(deployDialog.querySelectorAll('form')).forEach(form => {
      form.style.display = 'none';
    });
    form.style.display = 'block';
  });

  buttonsContainer.appendChild(appButton);

  // Create form
  const form = document.createElement('form');
  form.id = `form-${index}`;
  form.setAttribute('data-childname', childName);
  deployDialog.appendChild(form);

  if (index !== 0) {
    form.style.display = 'none';
  }

  if (inputs) {
    Object.entries(inputs)
      // Create only inputs that are not fe_* or wn_* (only applications inputs)
      .filter(([key, _]) => !key.startsWith('fe_') && !key.startsWith('wn_'))
      .forEach(([key, input]) => {
        const description = (input as any).description || key;
        const constraints = (input as any).constraints;
        const type = (input as any).type;
        const defaultValue = (input as any).default;

        let inputField: HTMLInputElement | HTMLSelectElement;

        if (
          constraints &&
          constraints.length > 0 &&
          constraints[0].valid_values
        ) {
          inputField = document.createElement('select');
          inputField.name = key;

          constraints[0].valid_values.forEach((value: string) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            if (value === defaultValue) {
              option.selected = true;
              inputField.value = defaultValue;
            }
            inputField.appendChild(option);
          });
        } else {
          inputField = document.createElement('input');
          inputField.name = key;

          if (type === 'integer' || type === 'float') {
            inputField.type = 'number';
            if (defaultValue !== undefined) {
              inputField.value = defaultValue;
              inputField.placeholder = String(defaultValue);
            }
          } else if (type === 'boolean') {
            inputField.type = 'checkbox';
            (inputField as HTMLInputElement).checked =
              defaultValue === true || defaultValue === 'true';
          } else {
            inputField.type = 'text';
            if (defaultValue !== undefined) {
              inputField.value = defaultValue;
              inputField.placeholder = String(defaultValue);
            }
          }
        }

        const label = document.createElement('label');
        label.htmlFor = key;
        label.textContent = `${description}:`;

        form.appendChild(label);
        form.appendChild(inputField);
      });
  } else {
    const p = document.createElement('p');
    p.textContent = 'No inputs to be filled.';
    form.appendChild(p);
  }

  return {
    form,
    nodeTemplates,
    outputs
  };
}

async function createImageDropdown(
  dropdownContainer: HTMLElement,
  nextBtn: HTMLButtonElement
): Promise<void> {
  appendVmImagesTitle(dropdownContainer);

  const loader = document.createElement('div');
  loader.className = 'mini-loader';
  dropdownContainer.appendChild(loader);

  try {
    const cmdImageNames = await selectImage(deployInfo);
    const outputText = await executeKernelCommand(cmdImageNames);
    dropdownContainer.removeChild(loader);

    await createImagesDropdown(outputText, dropdownContainer);

    if (dropdownContainer.querySelector('select')) {
      nextBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error loading image dropdown:', error);
    dropdownContainer.removeChild(loader);
  }
}

async function loadRecipeInputs(recipe: string): Promise<any | null> {
  try {
    const yamlData: any = await loadRecipeTemplate(recipe);
    return yamlData?.topology_template?.inputs || null;
  } catch (error) {
    console.error(`Failed to load recipe inputs for ${recipe}:`, error);
    return null;
  }
}

async function collectUserInputsFromForm(
  form: HTMLFormElement,
  childName: string,
  nodeTemplates: any,
  outputs: any
): Promise<UserInput | null> {
  const yamlData: any = await loadRecipeTemplate(childName);
  const recipeInputs = yamlData.topology_template.inputs;

  if (!recipeInputs) {
    return null;
  }

  const inputsWithValues: Record<string, any> = {};

  Object.entries(recipeInputs).forEach(([inputName, input]) => {
    const inputDef = structuredClone(input as any);
    const inputElement = form.querySelector<
      HTMLInputElement | HTMLSelectElement
    >(`[name="${CSS.escape(inputName)}"]`);

    const type = inputDef.type;

    if (inputElement) {
      if (type === 'boolean') {
        if (inputElement instanceof HTMLInputElement) {
          inputDef.default = inputElement.checked;
        }
      } else {
        const rawValue = inputElement.value.trim();
        if (rawValue !== '') {
          let parsedValue: any;
          if (type === 'integer') {
            parsedValue = parseInt(rawValue, 10);
          } else if (type === 'float') {
            parsedValue = parseFloat(rawValue);
          } else {
            parsedValue = rawValue;
          }

          inputDef.default = parsedValue;
        }
      }
    } else if (deployInfo.inputs && inputName in deployInfo.inputs) {
      inputDef.default = deployInfo.inputs[inputName];
    }

    inputsWithValues[inputName] = inputDef;
  });

  return {
    name: childName,
    type: 'child',
    inputs: inputsWithValues,
    nodeTemplates,
    outputs
  };
}

//*********************//
//*  Kernel commands  *//
//*********************//

async function selectImage(obj: IDeployInfo): Promise<string> {
  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  await persistAuthFile(obj);

  const cmd = `
from pathlib import Path
import subprocess

auth_file = Path(${JSON.stringify(authFilePath)})
cmd = [
    "python3",
    ${JSON.stringify(imClientPath)},
    "-q",
    "-a",
    str(auth_file),
    "-r",
    ${JSON.stringify(imEndpoint)},
    "cloudimages",
    ${JSON.stringify(obj.id)},
]
result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout)
if result.returncode != 0:
    raise RuntimeError(result.stdout)
          `;

  // console.log('Get cloud images:', cmd);
  console.log('Getting cloud images...');
  return cmd;
}

async function deployIMCommand(
  obj: IDeployInfo,
  mergedTemplate: string
): Promise<string> {
  const format = detectRecipeFormat(mergedTemplate);
  console.log('Detected format:', format);

  const deployedTemplatePath = await getDeployedTemplatePath(format);
  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  await writeTextFile(deployedTemplatePath, mergedTemplate);
  const deployedTemplateKernelPath = await getStateFilePath(
    `deployed-template.${format}`
  );

  const cmd = `
from pathlib import Path
import subprocess

auth_file = Path(${JSON.stringify(authFilePath)})
template_file = Path(${JSON.stringify(deployedTemplateKernelPath)})
cmd = [
    "python3",
    ${JSON.stringify(imClientPath)},
    "-a",
    str(auth_file),
    "create",
    str(template_file),
    "-r",
    ${JSON.stringify(imEndpoint)},
]
result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout)
if result.returncode != 0:
    raise RuntimeError(result.stdout)
`;

  console.log('TOSCA recipe deployed:', cmd);
  return cmd;
}

async function saveToInfrastructureList(
  obj: IInfrastructureData
): Promise<void> {
  await appendInfrastructureToList(obj);
  console.log('Data saved to infrastructuresList.json:', obj);
}

//****************//
//*  Deployment  *//
//****************//

const deployRecipeType = (dialogBody: HTMLElement): void => {
  dialogBody.innerHTML = '';

  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select recipe type:';
  dialogBody.appendChild(paragraph);

  // Create recipe buttons
  recipes.forEach(recipe => {
    const button = createButton(recipe.name, async () => {
      // Remove everything except recipe buttons
      Array.from(dialogBody.children).forEach(child => {
        if (
          !child.classList.contains('recipe-button') &&
          child !== footerButtonContainer
        ) {
          child.remove();
        }
      });

      deployInfo.recipe = recipe.name.trim().toLowerCase();
      if (recipe.childs.length === 0) {
        deployInfo.childs = [];
        deployChooseProvider(dialogBody);
        return;
      }

      await createCheckboxesForChilds(dialogBody, recipe.childs);
    });
    button.classList.add('recipe-button');
    dialogBody.appendChild(button);
  });

  if (!dialogBody.contains(footerButtonContainer)) {
    dialogBody.appendChild(footerButtonContainer);
  }

  footerButtonContainer.innerHTML = '';
};

const createCheckboxesForChilds = async (
  dialogBody: HTMLElement,
  childs: string[]
): Promise<void> => {
  // Create paragraph element for checkboxes
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select optional recipe features:';
  dialogBody.appendChild(paragraph);

  // Create checkbox grid
  const ul = document.createElement('ul');
  ul.classList.add('checkbox-grid');

  // Load YAML files and create checkboxes
  const promises = childs.map(async child => {
    // Parse YAML content
    const parsedYaml: any = await loadRecipeTemplate(child);
    const templateName = parsedYaml.metadata.template_name;

    // Create list item for checkbox
    const li = document.createElement('li');

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${child}-checkID`;
    checkbox.name = child.toLowerCase();
    checkbox.value = templateName;

    // Create label for checkbox
    const label = document.createElement('label');
    label.htmlFor = `${child.toLowerCase()}-checkID`;
    label.textContent = ` ${templateName}`;

    // Append checkbox and label to list item
    li.appendChild(checkbox);
    li.appendChild(label);

    ul.appendChild(li);
  });

  await Promise.all(promises);

  dialogBody.appendChild(ul);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';

  const nextButton = createButton('Next', () => {
    // Collect selected checkboxes
    const selectedChilds = Array.from(
      dialogBody.querySelectorAll('input[type="checkbox"]:checked')
    ).map((checkbox: Element) => (checkbox as HTMLInputElement).name);

    // Always include slurm if main recipe is one of them
    const mainRecipe = deployInfo.recipe.toLowerCase();
    const alwaysInclude = ['slurm'];
    if (alwaysInclude.includes(mainRecipe)) {
      selectedChilds.push(mainRecipe);
    }

    // Remove duplicates
    deployInfo.childs = Array.from(new Set(selectedChilds));

    deployChooseProvider(dialogBody);
  });
  buttonContainer.appendChild(nextButton);
  dialogBody.appendChild(buttonContainer);
};

const customRecipe = async (dialogBody: HTMLElement): Promise<void> => {
  dialogBody.innerHTML = '';
  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Recipe in RADL, YAML or JSON format.';
  textarea.classList.add('recipe-textarea');
  dialogBody.appendChild(textarea);

  const text = '<p class="form-instructions">Introduce your custom recipe.</p>';

  dialogBody.insertAdjacentHTML('afterbegin', text);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';

  const backBtn = createButton('Back', () => deployRecipeType(dialogBody));

  const nextButton = createButton('Deploy', async () => {
    const recipe = textarea.value;
    resetDeployInfo();
    deployInfo.infName = '';
    deployInfo.id = '';
    deployInfo.deploymentType = '';
    deployInfo.custom = 'true';

    try {
      const cmdDeploy = await deployIMCommand(deployInfo, recipe);

      dialogBody.innerHTML =
        '<div class="loader-container"><div class="loader"></div></div>';

      const outputText = await executeKernelCommand(cmdDeploy);
      handleFinalDeployOutput(outputText, dialogBody);
    } catch (error) {
      Notification.error(`Deployment failed: ${error || 'Unknown error'}`, {
        autoClose: 5000
      });
      deploying = false;
    }
  });

  buttonContainer.appendChild(backBtn);
  buttonContainer.appendChild(nextButton);
  dialogBody.appendChild(buttonContainer);
};

const deployChooseProvider = (dialogBody: HTMLElement): void => {
  dialogBody.innerHTML = '';

  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select infrastructure provider:';
  dialogBody.appendChild(paragraph);

  // Create buttons for each provider
  Object.keys(providers).forEach(provider => {
    const providerData = providers[provider as keyof typeof providers];
    const button = createButton(provider, () => {
      deployInfo.id = providerData.id;
      deployInfo.deploymentType = providerData.deploymentType;

      deployProviderCredentials(dialogBody);
      console.log(`Provider ${provider} selected`);
    });
    dialogBody.appendChild(button);
  });

  const backButton = createButton('Back', () => {
    deployRecipeType(dialogBody);
  });
  backButton.classList.add('back-button');

  const buttonContainer = document.createElement('div');
  buttonContainer.classList.add('footer-button-container');
  buttonContainer.appendChild(backButton);

  dialogBody.appendChild(buttonContainer);
};

const deployProviderCredentials = async (
  dialogBody: HTMLElement
): Promise<void> => {
  dialogBody.innerHTML = '';
  const form = document.createElement('form');
  dialogBody.appendChild(form);

  let text = '';
  let generatedAccessToken = '';

  switch (deployInfo.deploymentType) {
    case 'EC2': {
      const region = 'us-east-1';
      const ami = 'ami-0044130ca185d0880';

      text = '<p class="form-instructions">Introduce AWS IAM credentials.</p>';
      addFormInput(form, 'Access Key ID:', 'accessKeyId', deployInfo.username);
      addFormInput(
        form,
        'Secret Access Key:',
        'secretAccessKey',
        deployInfo.password,
        'password'
      );
      addFormInput(form, 'Region:', 'region', region);
      addFormInput(form, 'AMI:', 'amiIn', ami);
      break;
    }

    case 'OpenNebula':
    case 'OpenStack':
      text = `<p class="form-instructions">Introduce ${deployInfo.deploymentType === 'OpenNebula' ? 'ONE' : 'OST'} credentials.</p>`;

      addFormInput(form, 'Username:', 'username', deployInfo.username);
      addFormInput(
        form,
        'Password:',
        'password',
        deployInfo.password,
        'password'
      );
      addFormInput(form, 'Host and port:', 'host', deployInfo.host);
      if (deployInfo.deploymentType === 'OpenStack') {
        addFormInput(form, 'Tenant:', 'tenant', deployInfo.tenant);
        addFormInput(form, 'Domain:', 'domain', deployInfo.domain);
        addFormInput(
          form,
          'Auth version:',
          'authVersion',
          deployInfo.authVersion
        );
      }
      addFormInput(form, 'Access token:', 'access_token', '');
      break;

    case 'EGI':
      text = '<p class="form-instructions">Introduce EGI configuration.</p>';

      addFormInput(form, 'VO:', 'vo', deployInfo.vo);
      addFormInput(form, 'Site name:', 'site', deployInfo.host);
      const accessTokenInput = addFormInput(
        form,
        'Access token:',
        'access_token',
        '',
        'text',
        undefined,
        undefined,
        'Getting access token...'
      );
      accessTokenInput.disabled = true;

      const tokenStatus = document.createElement('div');
      tokenStatus.className = 'token-status';
      const tokenLoader = document.createElement('div');
      tokenLoader.className = 'mini-loader';
      const tokenStatusText = document.createElement('span');
      tokenStatusText.textContent = 'Getting access token...';
      tokenStatus.appendChild(tokenLoader);
      tokenStatus.appendChild(tokenStatusText);
      form.appendChild(tokenStatus);

      try {
        generatedAccessToken = await getAccessTokenFromShareManager();
        accessTokenInput.value = generatedAccessToken;
        accessTokenInput.placeholder = '';
        tokenStatus.remove();
      } catch (error) {
        console.warn('Could not get EGI access token automatically:', error);
        accessTokenInput.placeholder = 'Paste your EGI access token';
        tokenStatusText.textContent = 'Could not get token automatically.';
        tokenLoader.remove();
      } finally {
        accessTokenInput.disabled = false;
      }
      break;
  }

  form.insertAdjacentHTML('afterbegin', text);

  footerButtonContainer.innerHTML = '';

  const backBtn = createButton('Back', () => {
    deployChooseProvider(dialogBody);
    resetDeployInfo();
    deployInfo.custom = 'true';
  });

  const nextButton = createButton('Next', async () => {
    const form = dialogBody.querySelector('form')!;
    if (!form.reportValidity()) {
      Notification.error('Please fill in all required fields.', {
        autoClose: 5000
      });
      return;
    }

    switch (deployInfo.deploymentType) {
      case 'EC2': {
        const region = getInputValue('region');
        const AMI = getInputValue('amiIn');
        const imageURL = 'aws://' + region + '/' + AMI;
        deployInfo.image = imageURL;
        deployInfo.username = getInputValue('accessKeyId');
        deployInfo.password = getInputValue('secretAccessKey');
        break;
      }

      case 'OpenNebula':
      case 'OpenStack':
        deployInfo.username = getInputValue('username');
        deployInfo.password = getInputValue('password');
        deployInfo.host = getInputValue('host');
        if (deployInfo.deploymentType === 'OpenStack') {
          deployInfo.tenant = getInputValue('tenant');
          deployInfo.domain = getInputValue('domain');
          deployInfo.authVersion = getInputValue('authVersion');
        }
        deployInfo.accessToken = getInputValue('access_token');
        break;

      case 'EGI':
        deployInfo.host = getInputValue('site');
        deployInfo.vo = getInputValue('vo');
        deployInfo.accessToken = getInputValue('access_token').trim();
        deployInfo.accessTokenSource =
          generatedAccessToken && deployInfo.accessToken === generatedAccessToken
            ? 'auto'
            : 'manual';

        if (!deployInfo.accessToken) {
          Notification.error('Please provide a valid EGI access token.', {
            autoClose: 5000
          });
          return;
        }
        break;
    }

    await persistAuthFile(deployInfo);
    deployInfraConfiguration(dialogBody);
  });

  footerButtonContainer.appendChild(backBtn);
  footerButtonContainer.appendChild(nextButton);

  if (!dialogBody.contains(footerButtonContainer)) {
    dialogBody.appendChild(footerButtonContainer);
  }
};

async function deployInfraConfiguration(
  dialogBody: HTMLElement
): Promise<void> {
  dialogBody.innerHTML = '';
  const form = document.createElement('form');
  dialogBody.appendChild(form);

  const introParagraph = document.createElement('p');
  introParagraph.textContent =
    'Introduce front-end and worker VM specifications.';
  form.appendChild(introParagraph);

  addFormInput(
    form,
    'Infrastructure name',
    'infNameInput',
    deployInfo.infName || '',
    'text'
  );

  let inputs: any | null = null;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';
  dialogBody.appendChild(buttonContainer);

  const backBtn = createButton('Back', () =>
    deployProviderCredentials(dialogBody)
  );
  buttonContainer.appendChild(backBtn);

  const nextBtn = createButton(
    deployInfo.recipe === 'simple node disk' && deployInfo.childs.length === 0
      ? 'Deploy'
      : 'Next',
    async () => {
      try {
        const infNameElement =
          form.querySelector<HTMLInputElement>('#infNameInput');
        if (infNameElement) {
          deployInfo.infName = infNameElement.value.trim();
        }

        const imageDropdown = document.getElementById(
          'imageDropdown'
        ) as HTMLSelectElement;
        if (imageDropdown) {
          deployInfo.image = imageDropdown.value;
        }

        const allInputs = form.querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >('input, select');
        allInputs.forEach(input => {
          if (input.id === 'infNameInput') {
            return;
          }

          const inputName = input.name;
          const originalInputDef = inputs?.[inputName];
          const type = originalInputDef?.type;

          let value: any = input.value.trim();

          if (value === '') {
            return;
          }

          if (type === 'integer') {
            value = parseInt(value, 10);
          } else if (type === 'float') {
            value = parseFloat(value);
          }

          if (originalInputDef) {
            originalInputDef.default = value;
          }
          deployInfo.inputs[inputName] = value;

          // console.log(`Updated: '${inputName}' = ${value}`);
        });

        // console.log('All deployInfo.inputs:', deployInfo.inputs);

        if (
          deployInfo.recipe === 'simple node disk' &&
          deployInfo.childs.length === 0
        ) {
          await deployFinalRecipe(dialogBody);
        } else {
          await deployChildsConfiguration(dialogBody);
        }
      } catch (error) {
        console.error('Error in deployment process:', error);
        Notification.error(
          'Check for correct provider credentials before continuing.',
          { autoClose: 5000 }
        );
      }
    }
  );
  nextBtn.disabled = true;
  buttonContainer.appendChild(nextBtn);

  inputs = await loadRecipeInputs(deployInfo.recipe);

  if (inputs) {
    // Create form inputs for frontend and worker nodes
    Object.entries(inputs)
      .filter(([key, _]) => {
        if (excludedKeys.has(key)) {
          return false;
        }
        if (deployInfo.recipe === 'simple node disk') {
          return true;
        }
        return key.startsWith('fe_') || key.startsWith('wn_');
      })
      .forEach(([key, inputDef]) => {
        const description = (inputDef as any).description || key;
        const constraints = (inputDef as any).constraints;
        const defaultValue = (inputDef as any).default;

        let inputField: HTMLInputElement | HTMLSelectElement;

        if (
          constraints &&
          constraints.length > 0 &&
          constraints[0].valid_values
        ) {
          inputField = document.createElement('select');
          inputField.name = key;

          constraints[0].valid_values.forEach((value: string) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            if (value === defaultValue) {
              option.selected = true;
            }
            inputField.appendChild(option);
          });
        } else {
          inputField = document.createElement('input');
          inputField.type = 'text';
          inputField.name = key;
          inputField.placeholder = description;

          if (defaultValue !== undefined && defaultValue !== null) {
            inputField.value = defaultValue;
          }
        }

        const label = document.createElement('label');
        label.textContent = description;
        label.htmlFor = inputField.name;
        form.appendChild(label);
        form.appendChild(inputField);
      });
  } else {
    const noInputsMessage = document.createElement('p');
    noInputsMessage.textContent =
      'No inputs found. Check that the recipe template is available.';
    form.appendChild(noInputsMessage);
  }

  if (deployInfo.deploymentType !== 'EC2') {
    nextBtn.disabled = true;
  } else {
    nextBtn.disabled = false;
  }

  if (deployInfo.deploymentType !== 'EC2') {
    const dropdownContainer = document.createElement('div');
    dropdownContainer.id = 'dropdownContainer';
    dialogBody.insertBefore(dropdownContainer, buttonContainer);

    await createImageDropdown(dropdownContainer, nextBtn);
  }
}

const deployChildsConfiguration = async (
  dialogBody: HTMLElement
): Promise<void> => {
  dialogBody.innerHTML = '';

  const childs = deployInfo.childs;
  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = 'buttons-container';
  dialogBody.appendChild(buttonsContainer);

  // Create forms for child configurations
  const forms = await Promise.all(
    childs.map((childName, index) =>
      createChildsForm(childName, index, dialogBody, buttonsContainer)
    )
  );

  // Collect node templates and outputs from the forms
  const nodeTemplates = forms.map(form => form.nodeTemplates);
  const outputs = forms.map(form => form.outputs);

  // Create footer buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';

  const backBtn = createButton('Back', () =>
    deployInfraConfiguration(dialogBody)
  );

  const nextButton = createButton('Deploy', async () => {
    const userInputs = (
      await Promise.all(
        forms.map(async formData => {
          const form = formData.form;
          const childName = form.getAttribute('data-childname');
          if (!childName) {
            return null;
          }

          return await collectUserInputsFromForm(
            form,
            childName,
            formData.nodeTemplates,
            formData.outputs
          );
        })
      )
    ).filter((input): input is UserInput => input !== null);

    // console.log('All user inputs collected:', userInputs);

    deployFinalRecipe(dialogBody, userInputs, nodeTemplates, outputs);
  });

  buttonContainer.appendChild(backBtn);
  buttonContainer.appendChild(nextButton);
  dialogBody.appendChild(buttonContainer);
};

async function deployFinalRecipe(
  dialogBody: HTMLElement,
  populatedTemplates: UserInput[] = [],
  nodeTemplates: any[] = [],
  outputs: any[] = []
): Promise<void> {
  dialogBody.innerHTML = '';

  if (deploying) {
    Notification.error('Previous deploy has not finished.', {
      autoClose: 5000
    });
    return;
  }
  deploying = true;

  try {
    if (deployInfo.childs.length === 0) {
      const form = document.querySelector<HTMLFormElement>(
        '[data-single-form="true"]'
      );
      if (form) {
        const userInput = await collectUserInputsFromForm(
          form,
          deployInfo.recipe,
          {},
          {}
        );

        if (userInput) {
          populatedTemplates = [userInput];
        }
      }
    }
    const parsedTemplate = (await loadRecipeTemplate(deployInfo.recipe)) as any;

    // Add infrastructure name and a hash to the metadata
    parsedTemplate.metadata = parsedTemplate.metadata || {};
    parsedTemplate.metadata.infra_name = deployInfo.infName;

    // Populate the template with worker values
    const allInputs = { ...deployInfo.inputs };
    const mainInputs = parsedTemplate.topology_template.inputs;

    Object.entries(allInputs).forEach(([key, value]) => {
      if (!mainInputs[key]) {
        mainInputs[key] = {
          type: typeof value
        };
      }
      mainInputs[key].default = value;
    });

    dialogBody.innerHTML =
      '<div class="loader-container"><div class="loader"></div></div>';

    // Merge templates
    const mergedTemplate = await mergeTOSCARecipes(
      parsedTemplate,
      populatedTemplates,
      nodeTemplates,
      outputs
    );
    const mergedYamlContent = jsyaml.dump(mergedTemplate);

    const cmdDeploy = await deployIMCommand(deployInfo, mergedYamlContent);

    const outputText = await executeKernelCommand(cmdDeploy);
    handleFinalDeployOutput(outputText, dialogBody);
  } catch (error) {
    console.error('Error during deployment:', error);
  } finally {
    deploying = false;
  }
}

const handleFinalDeployOutput = async (
  output: string | undefined,
  dialogBody: HTMLElement
): Promise<void> => {
  if (!output) {
    return;
  }

  dialogBody.innerHTML = '';

  if (output.toLowerCase().includes('error')) {
    console.error('Error deploying infrastructure:', output);
    Notification.error(
      'Error deploying infrastructure. Check the console for more details.',
      {
        autoClose: 5000
      }
    );

    if (deployInfo.custom === 'true') {
      customRecipe(dialogBody);
    } else if (deployInfo.childs.length === 0) {
      deployInfraConfiguration(dialogBody);
    } else {
      deployChildsConfiguration(dialogBody);
    }
  } else {
    dialogBody.innerHTML = `
        <div class="success-container">
          <div class="success-circle">
            <i class="fas fa-check"></i>
          </div>
          <p>Infrastructure successfully deployed</p>
        </div>
      `;
    console.log('Infrastructure deployed:', output);
    Notification.success(output, {
      autoClose: 5000
    });

    // Extract infrastructure ID
    const idMatch = output.match(/ID: ([\w-]+)/);
    const infrastructureID = idMatch ? idMatch[1] : '';

    // Create a JSON object for infrastructure data
    const infrastructureData: IInfrastructureData = {
      accessToken: deployInfo.accessToken,
      accessTokenSource: deployInfo.accessTokenSource,
      name: deployInfo.infName,
      infrastructureID,
      id: deployInfo.id,
      type: deployInfo.deploymentType,
      host: deployInfo.host,
      tenant: deployInfo.tenant,
      user: deployInfo.username,
      pass: deployInfo.password,
      authVersion: deployInfo.authVersion,
      domain: deployInfo.domain,
      vo: deployInfo.vo,
      custom: deployInfo.custom
    };

    try {
      await saveToInfrastructureList(infrastructureData);
    } catch (error) {
      console.error('Error saving infrastructure data:', error);
      deploying = false;
    }
    resetDeployInfo();
  }
};

export { openDeploymentDialog };
