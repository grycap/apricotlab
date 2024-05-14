import * as jsyaml from 'js-yaml';
import { ContentsManager } from '@jupyterlab/services';

interface DeployInfo {
    recipe: string;
    id: string;
    deploymentType: string;
    host: string;
    tenant: string;
    user: string;
    credential: string;
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

let deployInfo: DeployInfo = {
    recipe: '',
    id: '',
    deploymentType: '',
    host: '',
    tenant: '',
    user: '',
    credential: '',
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
            //Check if the provider has been changed
            // if (deployInfo.deploymentType !== provider) {
            //     clearDeployInfo();
            // }

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
        });
        dialogBody.appendChild(button);
    });
};


    const deployRecipeType = (dialogBody: HTMLElement): void => {
        // Clear dialog body
        dialogBody.innerHTML = '';
    
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
            const button = document.createElement('button');
            button.textContent = recipe.name;
            button.addEventListener('click', () => {
                // Clear existing checkboxes
                clearCheckboxes(dialogBody);
            
                deployInfo.recipe = recipe.name;
                deployInfo.childs = recipe.childs;
                console.log(`Recipe ${recipe.name} selected`);
                createCheckboxesForChilds(dialogBody, recipe.childs);
            });
            dialogBody.appendChild(button);
        });
    };

    const clearCheckboxes = (dialogBody: HTMLElement): void => {
        // Remove all child nodes from dialog body
        while (dialogBody.firstChild) {
            dialogBody.removeChild(dialogBody.firstChild);
        }
    };

    const createCheckboxesForChilds = async (dialogBody: HTMLElement, childs: string[]): Promise<void> => {
        // Create paragraph element for checkboxes
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select optional recipe features:';
        dialogBody.appendChild(paragraph);
    
        // Create checkbox grid
        const ul = document.createElement('ul');
        ul.classList.add('checkbox-grid');
    
        // Load YAML files and create checkboxes
        for (const child of childs) {
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
        }
    
        // Append checkbox grid to dialog body
        dialogBody.appendChild(ul);
    };
