import * as jsyaml from 'js-yaml';
import { ContentsManager } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import { Dialog, Notification } from '@jupyterlab/apputils';
import {
  executeKernelCommand,
  getDeployableTemplatesPath,
  getInfrastructuresListPath,
  getIMClientPath,
  getDeployedTemplatePath,
  getAuthFilePath,
  createButton
} from './utils';

interface IDeployInfo {
  // IMuser: string;
  // IMpass: string;
  accessToken: any;
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
  worker: {
    num_instances: number;
    num_cpus: number;
    mem_size: string;
    disk_size: string;
    num_gpus: number;
    image: string;
    [key: string]: number | string;
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
  inputs: {
    [key: string]: {
      description: string;
      default: any;
      value: any;
    };
  };
  nodeTemplates: any;
  outputs: any;
};

interface IInfrastructureData {
  // IMuser: string;
  // IMpass: string;
  accessToken: string;
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
  // IMuser: '',
  // IMpass: '',
  accessToken: '',
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
  worker: {
    num_instances: 1,
    num_cpus: 1,
    mem_size: '2 GB',
    disk_size: '20 GB',
    num_gpus: 1,
    image: ''
  },
  childs: []
};

const recipes: IRecipe[] = [
  {
    name: 'Simple node disk',
    childs: ['galaxy', 'ansible_tasks', 'noderedvm', 'minio_compose']
  },
  {
    name: 'Slurm',
    childs: ['slurm_cluster', 'slurm_elastic', 'slurm_galaxy', 'docker_cluster']
  },
  {
    name: 'Kubernetes',
    childs: [
      'kubernetes',
      'kubeapps',
      'prometheus',
      'minio_compose',
      'noderedvm',
      'influxdb',
      'argo'
    ]
  },
  {
    name: 'Custom recipe',
    childs: []
  }
];

const providers = {
  EGI: { id: 'egi', deploymentType: 'EGI' },
  OpenStack: { id: 'ost', deploymentType: 'OpenStack' },
  OpenNebula: { id: 'one', deploymentType: 'OpenNebula' },
  EC2: { id: 'ec2', deploymentType: 'EC2' }
};

let imageOptions: { uri: string; name: string }[] = [];

let deploying = false; // Flag to prevent multiple deployments at the same time

const imEndpoint = 'https://deploy.sandbox.eosc-beyond.eu';

//*****************//
//* Aux functions *//
//*****************//

async function openDeploymentDialog(): Promise<void> {
  const dialogContent = document.createElement('div');

  deployRecipeType(dialogContent);

  const contentWidget = new Widget({ node: dialogContent });

  const dialog = new Dialog({
    title: 'Deploy Infrastructure',
    body: contentWidget,
    buttons: []
  });

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
  defaultValue?: string
): void => {
  const label = document.createElement('label');
  label.textContent = labelText;
  form.appendChild(label);

  const input = document.createElement('input');
  input.type = type;
  input.id = inputId;
  input.value = value;
  input.classList.add('jp-InputArea-editor', 'cm-editor');

  form.appendChild(input);
  form.appendChild(document.createElement('br'));
};

function getInputValue(inputId: string): string {
  const input = document.getElementById(inputId) as HTMLInputElement;
  return input.value;
}

async function computeHash(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// async function generateIMCredentials(): Promise<void> {
//   const randomInput = `${Date.now()}-${Math.random()}`;
//   const hash = await computeHash(randomInput);
//   // Use first 16 characters for user and next 16 characters for password
//   const user = hash.substring(0, 16);
//   const pass = hash.substring(16, 32);
//   deployInfo.IMuser = user;
//   deployInfo.IMpass = pass;
// }

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
  if (jsonStartIndex === -1) {
    console.error(
      'No OS images found. Check provider credentials or valid access token.'
    );
    return;
  }

  const jsonOutput = output.substring(jsonStartIndex).trim();

  try {
    const images: { uri: string; name: string }[] = JSON.parse(jsonOutput);
    imageOptions = images;
    console.log('Parsed images:', images);

    // Clear the dropdown container before appending new content
    dropdownContainer.innerHTML = '';

    const label = document.createElement('label');
    label.textContent = 'Images:';
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

async function mergeTOSCARecipes(
  parsedConstantTemplate: any,
  userInputs: UserInput[] | undefined,
  nodeTemplates: any[] | undefined,
  outputs: any[] | undefined
): Promise<any> {
  try {
    // Clone the parsed constant template to avoid mutating the original
    const mergedTemplate = JSON.parse(JSON.stringify(parsedConstantTemplate));

    // Process user inputs if defined and not empty
    if (userInputs && userInputs.length > 0) {
      const populatedTemplates = await Promise.all(userInputs);

      // Ensure populatedTemplates is not undefined
      if (populatedTemplates) {
        populatedTemplates.forEach(template => {
          if (template && template.inputs) {
            Object.entries(template.inputs).forEach(([inputName, input]) => {
              if (typeof input === 'object' && input !== null) {
                const inputValue = (input as ITemplateInput).value;

                // Merge or add inputs in the constant template
                if (inputName in mergedTemplate.topology_template.inputs) {
                  mergedTemplate.topology_template.inputs[inputName].default =
                    inputValue;
                } else {
                  mergedTemplate.topology_template.inputs = {
                    ...mergedTemplate.topology_template.inputs,
                    [inputName]: {
                      type: 'string',
                      description: inputName,
                      default: inputValue
                    }
                  };
                }
              }
            });
          }

          // Merge node templates
          if (template.nodeTemplates) {
            Object.entries(template.nodeTemplates).forEach(
              ([nodeTemplateName, nodeTemplate]) => {
                mergedTemplate.topology_template.node_templates = {
                  ...mergedTemplate.topology_template.node_templates,
                  [nodeTemplateName]: nodeTemplate
                };
              }
            );
          }

          // Merge outputs
          if (template.outputs) {
            Object.entries(template.outputs).forEach(([outputName, output]) => {
              mergedTemplate.topology_template.outputs = {
                ...mergedTemplate.topology_template.outputs,
                [outputName]: output
              };
            });
          }
        });
      }
    }

    return mergedTemplate;
  } catch (error) {
    console.error('Error merging TOSCA recipes:', error);
    return JSON.parse(JSON.stringify(parsedConstantTemplate));
  }
}

async function createChildsForm(
  app: string,
  index: number,
  deployDialog: HTMLElement,
  buttonsContainer: HTMLElement
) {
  const templatesPath = await getDeployableTemplatesPath();
  const contentsManager = new ContentsManager();

  // Load YAML content
  const file = await contentsManager.get(
    `${templatesPath}/${app.toLowerCase()}.yaml`
  );

  // Parse YAML content
  const yamlContent = file.content as string;
  const yamlData: any = jsyaml.load(yamlContent);
  const metadata = yamlData.metadata;
  const templateName = metadata.template_name;
  const inputs = yamlData.topology_template.inputs;
  const nodeTemplates = yamlData.topology_template.node_templates;
  const outputs = yamlData.topology_template.outputs;

  // Create child button
  const appButton = document.createElement('button');
  appButton.className = 'jp-Button child-buttons';
  appButton.textContent = templateName;

  // Show form for the selected child when clicked
  appButton.addEventListener('click', event => {
    event.preventDefault();
    Array.from(deployDialog.querySelectorAll('form')).forEach(form => {
      form.style.display = 'none'; // Hide all forms except the first one
    });
    form.style.display = 'block';
  });

  buttonsContainer.appendChild(appButton);

  // Create form
  const form = document.createElement('form');
  form.id = `form-${app.toLowerCase()}`;
  deployDialog.appendChild(form);

  // Show the form for the first child by default
  if (index !== 0) {
    form.style.display = 'none';
  }

  // Create input fields from YAML content
  if (inputs) {
    Object.entries(inputs).forEach(([key, input]) => {
      const description = (input as any).description;
      const constraints = (input as any).constraints;

      const inputField = document.createElement(
        constraints && constraints.length > 0 && constraints[0].valid_values
          ? 'select'
          : 'input'
      );
      inputField.id = key;
      inputField.name = key;

      if (
        constraints &&
        constraints.length > 0 &&
        constraints[0].valid_values
      ) {
        const validValues = constraints[0].valid_values;
        validValues.forEach((value: string) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          inputField.appendChild(option);
        });
      }

      const label = document.createElement('label');
      label.htmlFor = key;
      label.textContent = `${description}:`;

      form.appendChild(label);
      form.appendChild(inputField);
    });
  } else {
    form.innerHTML = '<p>No inputs to be filled.</p><br>';
  }

  return {
    form,
    nodeTemplates,
    outputs
  };
}

//*********************//
//*   Bash commands   *//
//*********************//

async function selectImage(obj: IDeployInfo): Promise<string> {
  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  // Command to create the IM-cli credentials
  let authContent = `id = im; type = InfrastructureManager; token = ${obj.accessToken};\n`;
  authContent += `id = ${obj.id}; type = ${obj.deploymentType}; host = ${obj.host}; `;

  if (obj.deploymentType === 'OpenNebula') {
    authContent += ` username = ${obj.username}; password = ${obj.password};`;
  } else if (obj.deploymentType === 'OpenStack') {
    authContent += `username = ${obj.username}; password = ${obj.password}; tenant = ${obj.tenant}; auth_version = ${obj.authVersion}; domain = ${obj.domain}`;
  } else if (obj.deploymentType === 'EGI') {
    authContent += ` vo = ${obj.vo}; token = ${obj.accessToken}`;
  }

  const cmd = `%%bash
            PWD=$(pwd)
            # Overwrite the auth file with new content
            echo -e "${authContent}" > $PWD/${authFilePath}
            # Create final command where the output is stored in "imageOut"
            imageOut=$(python3 ${imClientPath} -a $PWD/${authFilePath} -r ${imEndpoint} cloudimages ${obj.id})
            # Print IM output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $imageOut
                exit 1
            else
                echo -e $imageOut
            fi
          `;

  console.log('Get cloud images:', cmd);
  return cmd;
}

const getAccessToken = async (): Promise<string> => {
  try {
    const authFilePath = await getAuthFilePath();

    const code = `%%bash
      if [ -f ${authFilePath} ]; then
        token=$(grep -oP 'token\\s*=\\s*\\K[^;]+' ${authFilePath})  # Extract the token
        if [ -z "$token" ]; then
          echo "NO_TOKEN"
        else
          echo "$token"
        fi
      else
        echo "Auth file does not exist at: ${authFilePath}"
        echo "NO_TOKEN"
      fi
    `;

    const outputText = await executeKernelCommand(code);

    const token = outputText.trim();

    return token === 'NO_TOKEN' ? '' : token;
  } catch (error) {
    console.log('Error getting access token from authfile:', error);
    throw error;
  }
};

async function deployIMCommand(
  obj: IDeployInfo,
  mergedTemplate: string
): Promise<string> {
  const format = detectRecipeFormat(mergedTemplate);
  console.log('Detected format:', format);

  const deployedTemplatePath = await getDeployedTemplatePath(format);
  const imClientPath = await getIMClientPath();
  const authFilePath = await getAuthFilePath();

  const cmd = `%%bash
PWD=$(pwd)

# Save mergedTemplate in a file
cat << 'EOF' > ${deployedTemplatePath}
${mergedTemplate}
EOF
# Run IM CLI to deploy using the shared auth file
imageOut=$(python3 ${imClientPath} -a $PWD/${authFilePath} create ${deployedTemplatePath} -r ${imEndpoint})
# Print IM output on stderr or stdout
if [ $? -ne 0 ]; then
    >&2 echo -e $imageOut
    exit 1
else
    echo -e $imageOut
fi
`;

  console.log('TOSCA recipe deployed:', cmd);
  return cmd;
}

async function saveToInfrastructureList(
  obj: IInfrastructureData
): Promise<string> {
  const infrastructuresListPath = await getInfrastructuresListPath();

  // Bash command to update the infrastructuresList JSON
  const cmd = `%%bash
              PWD=$(pwd)
              existingJson=$(cat ${infrastructuresListPath})
              newJson=$(echo "$existingJson" | jq -c '.infrastructures += [${JSON.stringify(obj)}]')
              echo "$newJson" > ${infrastructuresListPath}
           `;

  console.log('Credentials saved to infrastructuresList.json:', cmd);
  return cmd;
}

//****************//
//*  Deployment  *//
//****************//

// generateIMCredentials().then(() => {
//   console.log(
//     'Generated random IM credentials:',
//     deployInfo.IMuser,
//     deployInfo.IMpass
//   );
// });

const deployRecipeType = (dialogBody: HTMLElement): void => {
  dialogBody.innerHTML = '';

  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select recipe type:';
  dialogBody.appendChild(paragraph);

  recipes.forEach(recipe => {
    // Create buttons for each recipe type
    const button = createButton(recipe.name, async () => {
      // Remove all children except buttons
      Array.from(dialogBody.children).forEach(child => {
        if (!child.classList.contains('recipe-button')) {
          dialogBody.removeChild(child);
        }
      });

      deployInfo.recipe = recipe.name;

      if (recipe.name === 'Custom recipe') {
        customRecipe(dialogBody);
      } else {
        await createCheckboxesForChilds(dialogBody, recipe.childs);
      }
    });
    button.classList.add('recipe-button');
    dialogBody.appendChild(button);
  });

  const buttonContainer = document.createElement('div');
  buttonContainer.classList.add('footer-button-container');

  dialogBody.appendChild(buttonContainer);
};

const createCheckboxesForChilds = async (
  dialogBody: HTMLElement,
  childs: string[]
): Promise<void> => {
  const templatesPath = await getDeployableTemplatesPath();

  // Create paragraph element for checkboxes
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select optional recipe features:';
  dialogBody.appendChild(paragraph);

  // Create checkbox grid
  const ul = document.createElement('ul');
  ul.classList.add('checkbox-grid');

  // Load YAML files and create checkboxes
  const contentsManager = new ContentsManager();
  const promises = childs.map(async child => {
    // Load YAML file asynchronously
    const file = await contentsManager.get(
      `${templatesPath}/${child.toLowerCase()}.yaml`
    );
    const yamlContent = file.content as string;

    // Parse YAML content
    const parsedYaml: any = jsyaml.load(yamlContent);
    const templateName = parsedYaml.metadata.template_name;

    // Create list item for checkbox
    const li = document.createElement('li');

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${child}-checkID`;
    checkbox.name = child;
    checkbox.value = templateName;

    // Create label for checkbox
    const label = document.createElement('label');
    label.htmlFor = child;
    label.textContent = ` ${templateName}`;

    // Check if recipe is Slurm or Kubernetes
    if (
      (deployInfo.recipe === 'Slurm' && child === 'slurm_cluster') ||
      (deployInfo.recipe === 'Kubernetes' && child === 'kubernetes')
    ) {
      checkbox.checked = true; // Check the checkbox
      checkbox.disabled = true; // Disable the checkbox
    }

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
    // Populate deployInfo.childs
    const selectedChilds = Array.from(
      dialogBody.querySelectorAll('input[type="checkbox"]:checked')
    ).map((checkbox: Element) => (checkbox as HTMLInputElement).name);
    deployInfo.childs = selectedChilds;
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

  const text = '<p>Introduce your custom recipe.</p><br>';

  dialogBody.insertAdjacentHTML('afterbegin', text);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';

  const backBtn = createButton('Back', () => deployRecipeType(dialogBody));

  const nextButton = createButton('Deploy', async () => {
    const recipe = textarea.value;
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
    deployInfo.custom = 'true';

    try {
      const cmdDeploy = await deployIMCommand(deployInfo, recipe);

      dialogBody.innerHTML =
        '<div class="loader-container"><div class="loader"></div></div>';

      const outputText = await executeKernelCommand(cmdDeploy);
      handleFinalDeployOutput(outputText, dialogBody);
    } catch (error) {
      console.error('Error during deployment:', error);
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

  switch (deployInfo.deploymentType) {
    case 'EC2': {
      const region = 'us-east-1';
      const ami = 'ami-0044130ca185d0880';

      text = '<p>Introduce AWS IAM credentials.</p><br>';
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
      // Get the access token to fill the form
      await getAccessToken().then(token => {
        const tokenStr = String(token);
        deployInfo.accessToken = tokenStr;
      });

      text = `<p>Introduce ${deployInfo.deploymentType === 'OpenNebula' ? 'ONE' : 'OST'} credentials.</p><br>`;
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
      addFormInput(
        form,
        'Access token:',
        'access_token',
        deployInfo.accessToken
      );
      break;

    case 'EGI':
      await getAccessToken().then(token => {
        const tokenStr = String(token);
        deployInfo.accessToken = tokenStr;
      });

      text = '<p>Introduce EGI credentials.</p><br>';
      addFormInput(form, 'VO:', 'vo', deployInfo.vo);
      addFormInput(form, 'Site name:', 'site', deployInfo.host);
      addFormInput(
        form,
        'Access token:',
        'access_token',
        deployInfo.accessToken
      );
      break;
  }

  form.insertAdjacentHTML('afterbegin', text);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';

  const backBtn = createButton('Back', () => {
    deployChooseProvider(dialogBody);
    deployInfo.host = '';
    deployInfo.tenant = '';
    deployInfo.username = '';
    deployInfo.password = '';
    deployInfo.authVersion = '';
    deployInfo.domain = '';
    deployInfo.vo = '';
    deployInfo.accessToken = '';
  });
  const nextButton = createButton('Next', async () => {
    const form = dialogBody.querySelector('form'); // Get the form element
    const inputs = form?.querySelectorAll('input'); // Get all input fields in the form

    // Loop through each input and check if it is empty
    let allFieldsFilled = true;
    inputs?.forEach(input => {
      if (!input.value) {
        allFieldsFilled = false;
      }
    });

    // Trigger error if any field is empty
    if (!allFieldsFilled) {
      Notification.error(
        'Please fill in all required fields before continuing.',
        { autoClose: 5000 }
      );
      return;
    }

    switch (deployInfo.deploymentType) {
      case 'EC2': {
        const region = getInputValue('region');
        const AMI = getInputValue('amiIn');
        const imageURL = 'aws://' + region + '/' + AMI;
        deployInfo.worker.image = imageURL;
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
        deployInfo.accessToken = getInputValue('access_token');
        break;
    }

    deployInfraConfiguration(dialogBody);
  });
  buttonContainer.appendChild(backBtn);
  buttonContainer.appendChild(nextButton);

  dialogBody.appendChild(buttonContainer);
};

async function deployInfraConfiguration(
  dialogBody: HTMLElement
): Promise<void> {
  dialogBody.innerHTML = '';
  const form = document.createElement('form');
  dialogBody.appendChild(form);

  const introParagraph = document.createElement('p');
  introParagraph.textContent = 'Introduce worker VM specifications.';
  form.appendChild(introParagraph);

  addFormInput(
    form,
    'Infrastructure name:',
    'infrastructureName',
    deployInfo.infName
  );
  addFormInput(
    form,
    'Number of VMs:',
    'infrastructureWorkers',
    '1',
    'number',
    '1'
  );
  addFormInput(
    form,
    'Number of CPUs for each VM:',
    'infrastructureCPUs',
    '1',
    'number',
    '1'
  );
  addFormInput(form, 'Memory for each VM:', 'infrastructureMem', '2 GB');
  addFormInput(
    form,
    'Size of the root disk of the VM(s):',
    'infrastructureDiskSize',
    '20 GB'
  );
  addFormInput(
    form,
    'Number of GPUs for each VM:',
    'infrastructureGPUs',
    '1',
    'number',
    '1'
  );

  // Create a button container to hold Back and Next/Deploy buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'footer-button-container';
  dialogBody.appendChild(buttonContainer);

  const backBtn = createButton('Back', () =>
    deployProviderCredentials(dialogBody)
  );
  buttonContainer.appendChild(backBtn);

  const nextBtn = createButton(
    deployInfo.childs.length === 0 ? 'Deploy' : 'Next',
    async () => {
      try {
        const imageDropdown = document.getElementById(
          'imageDropdown'
        ) as HTMLSelectElement;

        // Check if the dropdown exists
        if (imageDropdown) {
          deployInfo.worker.image = imageDropdown.value;
        }

        // Retrieve and parse form input values
        deployInfo.infName = getInputValue('infrastructureName');
        deployInfo.worker.num_instances = parseInt(
          getInputValue('infrastructureWorkers')
        );
        deployInfo.worker.num_cpus = parseInt(
          getInputValue('infrastructureCPUs')
        );
        deployInfo.worker.mem_size = getInputValue('infrastructureMem');
        deployInfo.worker.disk_size = getInputValue('infrastructureDiskSize');
        deployInfo.worker.num_gpus = parseInt(
          getInputValue('infrastructureGPUs')
        );

        // Check if we need to deploy final recipe or configure child components
        if (deployInfo.childs.length === 0) {
          await deployFinalRecipe(dialogBody);
        } else {
          await deployChildsConfiguration(dialogBody);
        }
      } catch (error) {
        console.error('Error in deployment process:', error);
        Notification.error(
          'Check for correct provider credentials before continuing.',
          {
            autoClose: 5000
          }
        );
      }
    }
  );

  if (deployInfo.deploymentType !== 'EC2') {
    nextBtn.disabled = true;
  }
  buttonContainer.appendChild(nextBtn);

  // Create the dropdown container for non-EC2 types
  if (deployInfo.deploymentType !== 'EC2') {
    const dropdownContainer = document.createElement('div');
    dropdownContainer.id = 'dropdownContainer';

    // Add a mini loader to the dropdown container
    const loader = document.createElement('div');
    loader.className = 'mini-loader';
    dropdownContainer.appendChild(loader);

    // Insert the dropdown container above the button container
    dialogBody.insertBefore(dropdownContainer, buttonContainer);

    // Create select image command
    const cmdImageNames = await selectImage(deployInfo);

    try {
      // Execute the deployment command
      const outputText = await executeKernelCommand(cmdImageNames);

      dropdownContainer.removeChild(loader); // Remove the loader once done

      await createImagesDropdown(outputText, dropdownContainer); // Pass the container to hold the dropdown
      if (dropdownContainer.querySelector('select') !== null) {
        nextBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error executing deployment command:', error);
    }
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
    childs.map((app, index) =>
      createChildsForm(app, index, dialogBody, buttonsContainer)
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
    const templatesPath = await getDeployableTemplatesPath();
    const contentsManager = new ContentsManager();

    const userInputs = (
      await Promise.all(
        forms.map(async formData => {
          const form = formData.form;
          const childName = form.id.replace('form-', '');

          // Fetch YAML content for the form
          const file = await contentsManager.get(
            `${templatesPath}/${childName}.yaml`
          );
          const yamlContent = file.content as string;
          const yamlData: any = jsyaml.load(yamlContent);
          const recipeInputs = yamlData.topology_template.inputs;

          if (recipeInputs) {
            // Create an object to hold input structure and values
            const inputsWithValues: {
              [key: string]: {
                description: string;
                default: any;
                value: any;
              };
            } = {};

            Object.entries(recipeInputs).forEach(([inputName, input]) => {
              const defaultValue = (input as any).default || '';
              const inputElement = form.querySelector<HTMLInputElement>(
                `[name="${inputName}"]`
              );
              const userInput = inputElement ? inputElement.value : ''; // Handle null case
              inputsWithValues[inputName] = {
                description: (input as any).description,
                default: defaultValue,
                value: userInput
              };
            });

            // Return the outputs to create final recipe to deploy
            return {
              name: childName,
              inputs: inputsWithValues,
              nodeTemplates: formData.nodeTemplates,
              outputs: formData.outputs
            };
          } else {
            console.error(
              `Error: recipeInputs is null or undefined for ${childName}.yaml`
            );
            return null;
          }
        })
      )
    ).filter((input): input is UserInput => input !== null); // Filter out null values

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
    const templatesPath = await getDeployableTemplatesPath();
    const contentsManager = new ContentsManager();
    const file = await contentsManager.get(
      `${templatesPath}/simple-node-disk.yaml`
    );
    const yamlContent = file.content;
    const parsedTemplate = jsyaml.load(yamlContent) as any;

    // Add infrastructure name and a hash to the metadata
    const hash = await computeHash(JSON.stringify(deployInfo));
    parsedTemplate.metadata = parsedTemplate.metadata || {};
    parsedTemplate.metadata.infra_name = `jupyter_${hash}`;

    // Populate the template with worker values
    const workerInputs = parsedTemplate.topology_template.inputs;
    Object.keys(deployInfo.worker).forEach(key => {
      workerInputs[key] = workerInputs[key] || {
        type: typeof deployInfo.worker[key]
      };
      workerInputs[key].default = deployInfo.worker[key];
    });

    // Merge templates
    const mergedTemplate = await mergeTOSCARecipes(
      parsedTemplate,
      populatedTemplates,
      nodeTemplates,
      outputs
    );
    const mergedYamlContent = jsyaml.dump(mergedTemplate);

    const cmdDeploy = await deployIMCommand(deployInfo, mergedYamlContent);

    dialogBody.innerHTML =
      '<div class="loader-container"><div class="loader"></div></div>';

    const outputText = await executeKernelCommand(cmdDeploy);
    handleFinalDeployOutput(outputText, dialogBody);
  } catch (error) {
    console.error('Error during deployment:', error);
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

  deploying = false;
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
    } else {
      deployInfo.childs.length === 0
        ? deployInfraConfiguration(dialogBody)
        : deployChildsConfiguration(dialogBody);
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
      // IMuser: deployInfo.IMuser,
      // IMpass: deployInfo.IMpass,
      accessToken: deployInfo.accessToken,
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

    const cmdSave = await saveToInfrastructureList(infrastructureData);

    // Execute kernel command to save the data
    try {
      const outputText = await executeKernelCommand(cmdSave);
      console.log('Data saved to infrastructuresList.json:', outputText);
    } catch (error) {
      console.error('Error executing kernel command:', error);
      deploying = false;
    }
    deployInfo.host = '';
    deployInfo.tenant = '';
    deployInfo.username = '';
    deployInfo.password = '';
    deployInfo.authVersion = '';
    deployInfo.domain = '';
    deployInfo.vo = '';
  }
};

export { openDeploymentDialog };
