import * as jsyaml from 'js-yaml';
import { ContentsManager } from '@jupyterlab/services';

export module DeploymentLogic {

    interface DeployInfo {
        recipe: string;
        id: string;
        deploymentType: string;
        host: string;
        tenant: string;
        username: string;
        password: string;
        port: string;
        infName: string;
        worker: {
            num_instances: number;
            num_cpus: number;
            mem_size: string;
            disk_size: string;
            num_gpus: number;
            image: string;
        };
        childs: string[];
    }

    export let deployInfo: DeployInfo = {
        recipe: '',
        id: '',
        deploymentType: '',
        host: '',
        tenant: '',
        username: '',
        password: '',
        port: '',
        infName: 'infra-name',
        worker: {
            num_instances: 1,
            num_cpus: 1,
            mem_size: '2 GB',
            disk_size: '20 GB',
            num_gpus: 1,
            image: '',
        },
        childs: [],
    };

    //****************//
    //*Aux functions *//
    //****************// 

    export const clearDialogBody = (dialogBody: HTMLElement): void => {
        dialogBody.innerHTML = '';
    };

    const createButton = (label: string, onClick: () => void): HTMLButtonElement => {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', onClick);
        // Set an id for the "Next" button
        if (label === 'Next') {
            button.id = 'nextButton';
        }
        return button;
    };

    const clearCheckboxes = (dialogBody: HTMLElement): void => {
        // Remove all elements except for the three buttons
        const elementsToRemove = dialogBody.querySelectorAll(':not(button)');
        elementsToRemove.forEach((element) => {
            // Check if the element is not one of the three buttons
            if (!element.classList.contains('recipe-button')) {
                element.remove(); // Remove the element
            }
        });
    };
    
    const addFormInput = (form: HTMLFormElement, labelText: string, inputId: string, value: string = '', type: string = 'text', p0?: string): void => {
        const label = document.createElement('label');
        label.textContent = labelText;
        form.appendChild(label);

        const input = document.createElement('input');
        input.type = type;
        input.id = inputId;
        input.value = value;
        form.appendChild(input);

        form.appendChild(document.createElement('br'));
    };

    //****************//
    //*  Deployment  *//
    //****************// 

    export const deployChooseProvider = (dialogBody: HTMLElement): void => {
        // Clear dialog body
        dialogBody.innerHTML = '';

        // Create paragraph element for instructions
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select infrastructure provider:';
        dialogBody.appendChild(paragraph);

        // Create buttons for each provider
        const providers = ['OpenNebula', 'EC2', 'OpenStack'];
        providers.forEach(provider => {
            const button = document.createElement('button');
            button.textContent = provider;
            button.addEventListener('click', () => {

                // Set deployInfo based on the selected provider
                switch (provider) {
                    case 'EC2':
                        deployInfo.id = 'ec2';
                        deployInfo.deploymentType = 'EC2';
                        break;
                    case 'OpenNebula':
                        deployInfo.id = 'one';
                        deployInfo.deploymentType = 'OpenNebula';
                        break;
                    case 'OpenStack':
                        deployInfo.id = 'ost';
                        deployInfo.deploymentType = 'OpenStack';
                        break;
                    default:
                        // Handle unsupported provider
                        console.error('Unsupported provider:', provider);
                        return;
                }

                deployRecipeType(dialogBody);
                console.log(`Provider ${provider} selected`);
                console.log('deployInfo:', deployInfo);
            });
            dialogBody.appendChild(button);
        });

    };

    export const deployRecipeType = (dialogBody: HTMLElement): void => {
        // Clear dialog body
        clearDialogBody(dialogBody);
        // const dialogContent = document.createElement('div');
    
        // Create paragraph element for instructions
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select recipe type:';
        dialogBody.appendChild(paragraph);
    
        // Define recipes and their corresponding child elements
        const recipes = [
            { name: 'Simple-node-disk', childs: ['galaxy', 'ansible_tasks', 'noderedvm', 'minio_compose'] },
            { name: 'Slurm', childs: ['slurm_cluster', 'slurm_elastic', 'slurm_galaxy', 'docker_cluster'] },
            { name: 'Kubernetes', childs: ['kubernetes', 'kubeapps', 'prometheus', 'minio_compose', 'noderedvm', 'influxdb', 'argo'] }
        ];
    
        // Create buttons for each recipe type
        recipes.forEach(recipe => {
            const button = createButton(recipe.name, () => {
                // Clear existing checkboxes
                clearCheckboxes(dialogBody);
    
                // Update deployInfo
                deployInfo.recipe = recipe.name;
                deployInfo.childs = recipe.childs;
    
                // Create checkboxes for child elements
                createCheckboxesForChilds(dialogBody, recipe.childs);
            });
    
            dialogBody.appendChild(button);
        });
    
        // Create "Next" button
        const nextButton = createButton('Next', () => {
            deployProviderCredentials(dialogBody);
        });
        dialogBody.appendChild(nextButton);
    };
    
    export const createCheckboxesForChilds = async (dialogBody: HTMLElement, childs: string[]): Promise<void> => {
        // Create paragraph element for checkboxes
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select optional recipe features:';
        dialogBody.appendChild(paragraph);

        // Create checkbox grid
        const ul = document.createElement('ul');
        ul.classList.add('checkbox-grid');

        // Load YAML files and create checkboxes
        await Promise.all(childs.map(async (child) => {
            // Load YAML file asynchronously
            const contentsManager = new ContentsManager();
            const file = await contentsManager.get(`src/templates/${child.toLowerCase()}.yaml`);
            const yamlContent = file.content as string;

            // Parse YAML content
            const parsedYaml: any = jsyaml.load(yamlContent);
            const metadata = parsedYaml.metadata;
            const templateName = metadata.template_name;

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
            if ((deployInfo.recipe === 'Slurm' && child === 'slurm_cluster') ||
                (deployInfo.recipe === 'Kubernetes' && child === 'kubernetes')) {
                checkbox.checked = true; // Check the checkbox
                checkbox.disabled = true; // Disable the checkbox
            }

            // Append checkbox and label to list item
            li.appendChild(checkbox);
            li.appendChild(label);

            // Append list item to checkbox grid
            ul.appendChild(li);
        }));

        // Append checkbox grid to dialog body
        dialogBody.appendChild(ul);
    };

    export const deployProviderCredentials = (dialogBody: HTMLElement): void => {
        clearDialogBody(dialogBody);
        const form = document.createElement('form');
        dialogBody.appendChild(form);

        let text = '';

        switch (deployInfo.deploymentType) {
            case 'EC2':
                // Added logic for EC2 specific inputs
                const zone = "us-east-1";
                const ami = "ami-0044130ca185d0880";

                text = `<p>Introduce AWS IAM credentials.</p><br>`;
                addFormInput(form, 'Access Key ID:', 'accessKeyId', deployInfo.username);
                addFormInput(form, 'Secret Access Key:', 'secretAccessKey', deployInfo.password, 'password');
                addFormInput(form, 'Availability zone:', 'availabilityZoneIn', zone);
                addFormInput(form, 'AMI:', 'amiIn', ami);
    
                if (deployInfo.recipe === "Simple-node-disk") {
                    // Port to be opened on AWS
                    addFormInput(form, 'Port to be opened in AWS:', 'infrastructurePort', '1', 'number');
                }
                break;

            case 'OpenNebula':
                text = `<p>Introduce ONE credentials.</p><br>`;
                addFormInput(form, 'Username:', 'username', deployInfo.username);
                addFormInput(form, 'Password:', 'password', deployInfo.password, 'password');
                addFormInput(form, 'Host and port:', 'host', deployInfo.host);
                break;

            case 'OpenStack':
                text = `<p>Introduce OST credentials.</p><br>`;
                addFormInput(form, 'Username:', 'username', deployInfo.username);
                addFormInput(form, 'Password:', 'password', deployInfo.password, 'password');
                addFormInput(form, 'Host and port:', 'host', deployInfo.host);
                addFormInput(form, 'Tenant:', 'tenant', deployInfo.tenant);
                break;
        }

        form.insertAdjacentHTML('afterbegin', text);

        // Create "Next" button
        const nextButton = createButton('Next', () => {
            const AWSzone = (document.getElementById('availabilityZoneIn') as HTMLInputElement).value;
            const AMI = (document.getElementById('amiIn') as HTMLInputElement).value;
            const imageURL = "aws://" + AWSzone + "/" + AMI;

            deployInfo.worker.image = imageURL;
            if (deployInfo.recipe === "Simple-node-disk") {
                deployInfo.port = (document.getElementById('infrastructurePort') as HTMLInputElement).value.toString();
            }
            deployInfraConfiguration(dialogBody);
        });
        dialogBody.appendChild(nextButton);
    };

    const deployInfraConfiguration = (dialogBody: HTMLElement): void => {
        clearDialogBody(dialogBody);
        const form = document.createElement('form');
        dialogBody.appendChild(form);
    
        const introParagraph = document.createElement('p');
        introParagraph.textContent = "Introduce worker VM specifications.";
        form.appendChild(introParagraph);
    
        addFormInput(form, 'Infrastructure name:', 'infrastructureName', deployInfo.infName);
        addFormInput(form, 'Number of VMs:', 'infrastructureWorkers', '1', 'number', '1');
        addFormInput(form, 'Number of CPUs for each VM:', 'infrastructureCPUs', '1', 'number', '1');
        addFormInput(form, 'Memory for each VM:', 'infrastructureMem', '2 GB');
        addFormInput(form, 'Size of the root disk of the VM(s):', 'infrastructureDiskSize', '20 GB');
        addFormInput(form, 'Number of GPUs for each VM:', 'infrastructureGPUs', '1', 'number', '1');
    
        const backBtn = createButton('Back', () => deployProviderCredentials(dialogBody));
        const nextBtn = createButton(deployInfo.childs.length === 0 ? "Deploy" : "Next", () => {
            deployInfo.infName = getInputValue('infrastructureName');
            deployInfo.worker.num_instances = parseInt(getInputValue('infrastructureWorkers'));
            deployInfo.worker.num_cpus = parseInt(getInputValue('infrastructureCPUs'));
            deployInfo.worker.mem_size = getInputValue('infrastructureMem');
            deployInfo.worker.disk_size = getInputValue('infrastructureDiskSize');
            deployInfo.worker.num_gpus = parseInt(getInputValue('infrastructureGPUs'));
    
            if (deployInfo.childs.length === 0) {
                //deployFinalRecipe();
            } else {
                //deployChildsConfiguration();
            }
        });
    
        dialogBody.appendChild(backBtn);
        dialogBody.appendChild(nextBtn);
    };

    function getInputValue(inputId: string): string {
        const input = document.getElementById(inputId) as HTMLInputElement;
        return input.value;
    };

}