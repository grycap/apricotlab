from tabulate import tabulate
from IPython.core.magic import Magics, line_magic, line_cell_magic, magics_class
from subprocess import run, PIPE, CalledProcessError
from pathlib import Path

import os
import json

IM_URL = 'https://im.egi.eu/im'

@magics_class
class Apricot_Magics(Magics):

    def __init__(self, shell):
        super().__init__(shell)
        self.load_paths()

    ########################
    #  Auxiliar functions  #
    ########################

    def load_paths(self):
        # Get the absolute path to the current file (apricot_magics.py)
        current_dir = Path(__file__).parent

        # Construct the path to the 'resources' folder relative to 'apricot_magics/'
        resources_dir = current_dir.parent / "resources"

        self.inf_list_path = resources_dir / "infrastructuresList.json"
        self.deployedTemplate_path = resources_dir / "deployed-template.yaml"

        # Check if the files exist
        if not self.inf_list_path.exists():
            raise FileNotFoundError(f"File not found: {self.inf_list_path}")
        if not self.deployedTemplate_path.exists():
            raise FileNotFoundError(f"File not found: {self.deployedTemplate_path}")
        
        self.im_client_path = self.find_im_client()
        if not self.im_client_path:
            raise FileNotFoundError("im_client.py executable not found in PATH")

    def find_im_client(self) -> str:
        executable_name = "im_client.py"
        try:
            # Use 'which' command to find the executable
            result = run(['which', executable_name], stdout=PIPE, stderr=PIPE, check=True, text=True)
            executable_path = result.stdout.strip()
            return executable_path
        except (CalledProcessError, FileNotFoundError):
            return None

    def load_json(self, path):
        """Load a JSON file and handle errors."""
        try:
            with open(path) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            raise ValueError(f"Error loading JSON from {path}: {e}")

    def cleanup_files(self, *files):
        for file in files:
            if os.path.exists(file):
                os.remove(file)

    def execute_command(self, cmd):
        """Execute a command and return stdout, or handle the output differently."""
        try:
            result = run(cmd, stdout=PIPE, stderr=PIPE, check=True, text=True)
            return result.stdout  # Return only stdout
        except CalledProcessError as e:
            return "Fail"

    def create_auth_pipe(self, infrastructure_id):
        """ Create an auth pipe file with credentials based on the infrastructure type. """
        data = self.load_json(self.inf_list_path)

        # Find the infrastructure with the specified ID
        infrastructure = None
        for file_infrastructure in data.get('infrastructures', []):
            if file_infrastructure.get('infrastructureID') == infrastructure_id:
                infrastructure = file_infrastructure
                break
        
        if not infrastructure:
            raise ValueError(f"Infrastructure with ID {infrastructure_id} does not exist.")
        
        auth_content = [f"type = InfrastructureManager; username = {infrastructure['IMuser']}; password = {infrastructure['IMpass']};"]
        infra_type = infrastructure['type']
        
        # Append credentials based on the infrastructure type
        if infra_type == "OpenStack":
            auth_content.append(f"id = {infrastructure['id']}; type = {infra_type}; username = {infrastructure['user']}; password = {infrastructure['pass']}; host = {infrastructure['host']}; tenant = {infrastructure['tenant']}; auth_version = {infrastructure['authVersion']}; domain = {infrastructure['domain']}")
        elif infra_type == "OpenNebula":
            auth_content.append(f"id = {infrastructure['id']}; type = {infra_type}; username = {infrastructure['user']}; password = {infrastructure['pass']}; host = {infrastructure['host']}")
        elif infra_type == "EC2":
            auth_content.append(f"id = {infrastructure['id']}; type = {infra_type}; username = {infrastructure['user']}; password = {infrastructure['pass']}")
        elif infra_type == "EGI":
            auth_content.append(f"id = {infrastructure['id']}; type = {infra_type}; host = {infrastructure['host']}; vo = {infrastructure['vo']}; token = {infrastructure['EGIToken']}")
        
        # Write auth-pipe content to a file
        with open('auth-pipe', 'w') as auth_file:
            auth_file.write("\n".join(auth_content))

    def generate_key(self, infrastructure_id, vm_id):
        """ Generates private key and host IP from infrastructure and VM info. """
        cmd_getvminfo = [
            'python3', self.im_client_path, 'getvminfo', infrastructure_id, vm_id, '-r', IM_URL, '-a', 'auth-pipe'
        ]

        try:
            # Execute command and capture output
            state_output = self.execute_command(cmd_getvminfo)
            private_key_content, host_ip = None, None

            if state_output:
                private_key_content = self.extract_key(state_output)
                host_ip = self.extract_host_ip(state_output)

                # Save the private key to a file
                if private_key_content:
                    with open("key.pem", "w") as key_file:
                        key_file.write(private_key_content)
                    os.chmod("key.pem", 0o600)

            return private_key_content, host_ip
        except CalledProcessError as e:
            return None, None

    def extract_key(self, output):
        """ Extract the private key from VM info. """
        private_key_lines = []
        capture_key = False

        for line in output.splitlines():
            if "disk.0.os.credentials.private_key =" in line:
                capture_key = True
                private_key_lines.append(line.split(" = ")[1].strip().strip("'"))
                continue

            if capture_key:
                private_key_lines.append(line.strip())
                if "END RSA PRIVATE KEY" in line:
                    break

        return "\n".join(private_key_lines) if private_key_lines else None

    def extract_host_ip(self, output):
        """ Extract the host IP from VM info. """
        for line in output.splitlines():
            if "net_interface.1.ip =" in line:
                return line.split("'")[1].strip()
        return None

    def resolve_ssh_user(self, inf_id):
        cmd_getinfo = [
            'python3',
            self.im_client_path,
            'getinfo',
            inf_id,
            '-r',
            IM_URL,
            '-a',
            'auth-pipe',
        ]

        # Use execute_command to run the command and capture output
        getinfo_output = self.execute_command(cmd_getinfo)

        # If there is no output, return None
        if getinfo_output is None:
            return None

        # Find the line containing 'disk.0.os.credentials.username' and extract the user
        ssh_user = None
        for line in getinfo_output.splitlines():
            if "disk.0.os.credentials.username" in line:
                ssh_user = line.split('=')[1].strip().split(' ')[0].strip("'")
                break
        
        return ssh_user if ssh_user else None

    def apricot_transfer(self, inf_id, vm_id, files, destination, transfer_type):
        """Handle SCP upload and download."""
        
        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Generate private key content and host IP
        private_key_content, hostIP = self.generate_key(inf_id, vm_id)
        if not private_key_content:
            print("Error: Unable to generate private key.")
            return "Failed"

        ssh_user = self.resolve_ssh_user(inf_id)
        if not ssh_user:
            print(f"Error: Unable to resolve SSH user for infrastructure {inf_id}.")
            return "Failed"

        # Construct the SCP command
        cmd_scp = [
            'scp',
            '-i', 'key.pem',
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
        ]

        # Add file paths based on the transfer type
        if transfer_type == 'upload':
            # Add local files and remote destination
            cmd_scp.extend(files)
            cmd_scp.append(f'{ssh_user}@{hostIP}:{destination}')
        else:
            # Add remote files and local destination
            for file in files:
                cmd_scp.append(f'{ssh_user}@{hostIP}:{file}')
            cmd_scp.append(destination)

        # Execute the SCP command using execute_command
        result = self.execute_command(cmd_scp)
        if result == "Fail":
            return "Failed"
        
        # Clean up temporary files
        self.cleanup_files('auth-pipe', 'key.pem')

        return "Done"

    def get_infrastructure_state(self, inf_id):
        cmd_getstate = ['python3', self.im_client_path, 'getstate', inf_id, '-r', IM_URL, '-a', 'auth-pipe']
        output = self.execute_command(cmd_getstate)

        if output:
            # Split the output into lines and look for the relevant state line
            for line in output.splitlines():
                if "The infrastructure is in state:" in line:
                    # Extract and return the last word of the line after the colon
                    return line.split(':')[-1].strip()
        return cmd_getstate

    def get_vm_ip(self, inf_id):
        cmd_getvminfo = ['python3', self.im_client_path, 'getvminfo', inf_id, '0', 'net_interface.1.ip', '-r', IM_URL, '-a', 'auth-pipe']
        output = self.execute_command(cmd_getvminfo)

        if output:
            # Split the output into lines and return the last line
            return output.splitlines()[-1].strip()
        
        return cmd_getvminfo

    ##################
    #     Magics     #
    ##################

    @line_magic
    def apricot_log(self, line):
        if not line:
            return "Usage: apricot_log infrastructure-id"

        inf_id = line.split()[0]

        try:
            self.create_auth_pipe(inf_id)
            cmd_getcontmsg = ["python3", self.im_client_path, "getcontmsg", inf_id, "-a", "auth-pipe", "-r", IM_URL]
            output = self.execute_command(cmd_getcontmsg)
            print(output)
        except ValueError as e:
            print("Status: fail. " + str(e) + "\n")
            return "Failed"
        finally:
            self.cleanup_files('auth-pipe')
    
    @line_magic
    def apricot_ls(self, line):
        infrastructures_list = []

        data = self.load_json(self.inf_list_path)

        for infrastructure in data.get('infrastructures', []):
            infrastructure_info = {
                'Name': infrastructure.get('name', ''),
                'InfrastructureID': infrastructure.get('infrastructureID', ''),
                'IP': '',
                'State': ''
            }

            try:
                self.create_auth_pipe(infrastructure_info['InfrastructureID'])
                infrastructure_info['State'] = self.get_infrastructure_state(infrastructure_info['InfrastructureID'])
                infrastructure_info['IP'] = self.get_vm_ip(infrastructure_info['InfrastructureID'])
            finally:
                self.cleanup_files('auth-file')

            infrastructures_list.append(infrastructure_info)

        infrastructure_data = [
            [infra['Name'], infra['InfrastructureID'], infra['IP'], infra['State']] for infra in infrastructures_list
        ]

        print(tabulate(infrastructure_data, headers=['Infrastructure name', 'Infrastructure ID', 'IP Address', 'Status'], tablefmt='grid'))
    
    @line_magic
    def apricot_info(self, line):
        if not line:
            return "Usage: apricot_info infrastructure-id"

        inf_id = line.split()[0]

        try:
            self.create_auth_pipe(inf_id)
            cmd_getinfo = ["python3", self.im_client_path, "getinfo", inf_id, "-a", "auth-pipe", "-r", IM_URL]
            output = self.execute_command(cmd_getinfo)
            print(output)
        except ValueError as e:
            print("Status: fail. " + str(e) + "\n")
            return "Failed"
        finally:
            self.cleanup_files('auth-file')

    @line_magic
    def apricot_vmls(self, line):
        if not line:
            print("Usage: apricot_vmls infrastructure-id\n")
            return "Fail"

        inf_id = line.split()[0]
        vm_info_list = []

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print("Status: fail. " + str(e) + "\n")
            return "Failed"

        cmd_getinfo = ['python3', self.im_client_path, 'getinfo', inf_id, '-r', IM_URL, '-a', 'auth-pipe']
        output = self.execute_command(cmd_getinfo)
        if not output:
            return "Fail"

        current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None
        for line in output.splitlines():
            if line.startswith("Info about VM with ID:"):
                current_vm_id = line.split(":")[1].strip()
            elif "net_interface.1.ip =" in line:
                ip_address = line.split("'")[1].strip()
            elif "state =" in line:
                status = line.split("'")[1].strip()
            elif "provider.type =" in line:
                provider_type = line.split("'")[1].strip()
            elif "disk.0.image.url =" in line:
                os_image = line.split("'")[1].strip()

            if all((current_vm_id, ip_address, provider_type, os_image, status)):
                vm_info_list.append([current_vm_id, ip_address, provider_type, os_image, status])
                current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None

        print(tabulate(vm_info_list, headers=['VM ID', 'IP Address', 'Provider', 'OS Image', 'Status'], tablefmt='grid'))
        self.cleanup_files('auth-pipe')

        return

    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0 or len(line.split()) < 4:
            print("Usage: apricot_upload infrastructure-id vm-id file1 file2 ... fileN remote-destination-path\n")
            return "Fail"

        words = line.split()
        inf_id = words[0]
        vm_id = words[1]
        destination = words[-1]
        files = words[2:-1]

        return self.apricot_transfer(inf_id, vm_id, files, destination, transfer_type='upload')

    @line_magic
    def apricot_download(self, line):
        if len(line) == 0 or len(line.split()) < 4:
            print("Usage: apricot_download infrastructure-id vm-id file1 file2 ... fileN local-destination-path\n")
            return "Fail"

        words = line.split()
        inf_id = words[0]
        vm_id = words[1]
        destination = words[-1]
        files = words[2:-1]

        return self.apricot_transfer(inf_id, vm_id, files, destination, transfer_type='download')

    @line_cell_magic
    def apricot(self, code, cell=None):
        # Check if it's a cell call
        if cell is not None:
            lines = cell.split('\n')
            for line in lines:
                if len(line) > 0:
                    result = self.apricot(line.strip())
                    if result != "Done":
                        print("Execution stopped")
                        return f"Fail on line: '{line.strip()}'"
            return "Done"

        # Check if the code is empty
        if len(code) == 0:
            return "Fail"

        words = [word for word in code.split() if word]
        word1 = words[0]

        if word1 in {"exec"}:
            if len(words) < 4:
                print(f"Incomplete instruction: '{code}' \n 'exec' format is: 'exec infrastructure-id vm-id cmd-command'")
                return "Fail"
            else:
                inf_id = words[1]
                vm_id = words[2]
                cmd_command = words[3:]

                try:
                    self.create_auth_pipe(inf_id)
                except ValueError as e:
                    print(e)
                    return "Failed"

                ssh_user = self.resolve_ssh_user(inf_id)
                if not ssh_user:
                    print(f"Error: Unable to resolve SSH user for infrastructure {inf_id}.")
                    return "Failed"

                private_key_content, host_ip = self.generate_key(inf_id, vm_id)
                if not private_key_content:
                    print("Error: Unable to generate private key. Missing infrastructure ID or VM ID.")
                    return "Failed"

                cmd_ssh = ['ssh', '-i', 'key.pem', '-o', 'StrictHostKeyChecking=no', f'{ssh_user}@{host_ip}'] + cmd_command
                result = self.execute_command(cmd_ssh)

                if result != "Fail":
                    print(result)
                return "Done"

        elif word1 == "list":
            return self.apricot_ls('')

        elif word1 == "destroy":
            if len(words) != 2:
                print("Usage: destroy infrastructure-id")
                return "Fail"
            else:
                inf_id = words[1]

                try:
                    self.create_auth_pipe(inf_id)
                except ValueError as e:
                    print("Status: fail. " + str(e) + "\n")
                    return "Failed"

                cmd_destroy = [
                    'python3',
                    self.im_client_path,
                    'destroy',
                    inf_id,
                    '-r',
                    IM_URL,
                    '-a',
                    'auth-pipe',
                ]

                try:
                    print("Destroying... Please wait, this may take a few seconds.", end='', flush=True)
                    result = self.execute_command(cmd_destroy)

                    # Clear the message
                    print("\r" + " " * len("Destroying... Please wait, this may take a few seconds."), end='', flush=True)
                    print("\r", end='', flush=True)

                    if result != "Fail":
                        print(result)

                    # Load infrastructure list from JSON file
                    try:
                        with open(self.inf_list_path, 'r') as f:
                            data = json.load(f)
                    except (FileNotFoundError, json.JSONDecodeError) as e:
                        print(f"Error loading infrastructure list: {e}")
                        return "Failed"

                    # Find and remove the infrastructure with the specified ID
                    for infrastructure in data['infrastructures']:
                        if infrastructure['infrastructureID'] == inf_id:
                            data['infrastructures'].remove(infrastructure)
                            break

                    # Write the updated infrastructure list back to the JSON file
                    try:
                        with open(self.inf_list_path, 'w') as f:
                            json.dump(data, f, indent=4)
                    except IOError as e:
                        print(f"Error writing to file {self.inf_list_path}: {e}")
                        return "Failed"
                
                except CalledProcessError as e:
                    print(f"Error: {e}")
                    return "Failed"
                finally:
                    self.cleanup_files('auth-pipe', 'key.pem')

                return "Done"

        return "Done"

def load_ipython_extension(ipython):
    """
    Any module file that define a function named `load_ipython_extension`
    can be loaded via `%load_ext module.path` or be configured to be
    autoloaded by IPython at startup time.
    """
    ipython.register_magics(Apricot_Magics)
