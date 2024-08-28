from tabulate import tabulate
from IPython.core.magic import Magics, line_magic, line_cell_magic, magics_class
from subprocess import run, PIPE, CalledProcessError, check_output

import os
import json

@magics_class
class Apricot_Magics(Magics):

    def __init__(self, shell):
        super().__init__(shell)
        self.im_client_path = None

    ########################
    #  Auxiliar functions  #
    ########################

    def find_im_client_path(self) -> str:
        try:
            im_client_path = check_output(['which', 'im_client.py'], text=True).strip()
            if not im_client_path:
                raise FileNotFoundError("im_client.py not found in the system PATH.")
            return im_client_path
        except CalledProcessError:
            raise FileNotFoundError("Failed to find im_client.py in the system PATH.")

    def get_im_client_path(self) -> str:
        if self.im_client_path is None:
            self.find_im_client_path()
        return self.im_client_path

    def create_auth_pipe(self, infrastructure_id):
        # Get the absolute path to the infrastructuresList.json file
        base_dir = os.path.dirname(__file__)
        file_path = os.path.abspath(os.path.join(base_dir, '..', 'infrastructuresList.json'))

        # Read the JSON data from the file
        try:
            with open(file_path) as f:
                data = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"File not found: {file_path}")
        except json.JSONDecodeError:
            raise ValueError(f"Error decoding JSON from file: {file_path}")

        # Find the infrastructure with the specified ID
        found_infrastructure = None
        for infrastructure in data.get('infrastructures', []):
            if infrastructure.get('infrastructureID') == infrastructure_id:
                found_infrastructure = infrastructure
                break

        if found_infrastructure is None:
            raise ValueError(f"Infrastructure with ID {infrastructure_id} does not exist.")

        # Construct auth-pipe content based on infrastructure type
        auth_content = f"type = InfrastructureManager; username = {found_infrastructure['IMuser']}; password = {found_infrastructure['IMpass']};\n"
        # Additional credentials based on infrastructure type
        if found_infrastructure['type'] == "OpenStack":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}; host = {found_infrastructure['host']}; tenant = {found_infrastructure['tenant']}; auth_version = {found_infrastructure['authVersion']}; domain = {found_infrastructure['domain']}"
        elif found_infrastructure['type'] == "OpenNebula":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}; host = {found_infrastructure['host']}"
        elif found_infrastructure['type'] == "EC2":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}"
        elif found_infrastructure['type'] == "EGI":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; host = {found_infrastructure['host']}; vo = {found_infrastructure['vo']}; token = {found_infrastructure['EGIToken']}"
        
        # Write auth-pipe content to a file
        with open('auth-pipe', 'w') as auth_file:
            auth_file.write(auth_content)

        return

    def generate_key(self, infrastructure_id, vm_id):
        ##########################################
        #   Generates private key and host IP    #
        ##########################################
        private_key_content = None
        host_ip = None
        im_client_path = self.get_im_client_path()

        cmd_getvminfo = [
            'python3',
            im_client_path,
            'getvminfo',
            infrastructure_id,
            vm_id,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        try:
            # Execute command and capture output
            state_output = run(cmd_getvminfo, stdout=PIPE, stderr=PIPE, check=True, text=True).stdout
            # Split the output by lines
            state_lines = state_output.split('\n')

            # Iterate over each line in the output to capture key and host IP
            private_key_started = False
            for line in state_lines:
                if line.strip().startswith("disk.0.os.credentials.private_key ="):
                    private_key_started = True
                    private_key_content = line.split(" = ")[1].strip().strip("'") + '\n'
                    continue
                # If private key capture has started, capture lines until END RSA PRIVATE KEY
                if private_key_started:
                    private_key_content += line + '\n'
                # Check if the line contains the end of the private key
                if "END RSA PRIVATE KEY" in line:
                    private_key_started = False

                if line.strip().startswith("net_interface.1.ip ="):
                    # Extract the host IP
                    host_ip = line.split("'")[1].strip()
                    break

            if private_key_content:
                with open("key.pem", "w") as key_file:
                    key_file.write(private_key_content)

                # Change permissions of key.pem to 600
                os.chmod("key.pem", 0o600)

            return private_key_content, host_ip

        except CalledProcessError as e:
            # If the subprocess call fails, return the error output
            return None, None

    ##################
    #     Magics     #
    ##################

    @line_magic
    def apricot_log(self, line):
        if len(line) == 0:
            print("Usage: apricot_log infrastructure-id\n")
            return "Fail"

        im_client_path = self.get_im_client_path()
        
        # Split the input line to extract the infrastructure ID
        inf_id = line.split()[0]

        try:
            # Create auth-pipe for the specified infrastructure
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Construct the command to retrieve log messages
        cmd_getcontmsg = [
            "python3",
            im_client_path,
            "getcontmsg",
            inf_id,
            "-a",
            "auth-pipe",
            "-r",
            "https://im.egi.eu/im",
        ]

        try:
            # Run the command, capturing stdout and stderr
            result = run(cmd_getcontmsg, stdout=PIPE, stderr=PIPE, check=True, text=True)
            print(result.stdout)
        except CalledProcessError as e:
            # Handle errors raised by the command
            print("Status: fail " + str(e.returncode) + "\n")
            print(e.stderr + "\n")
            print(e.stdout)
            return "Fail"
        finally:
            # Clean up auth-pipe file
            if os.path.exists('auth-pipe'):
                os.remove('auth-pipe')

    @line_magic
    def apricot_ls(self, line):
        infrastructures_list = []
        im_client_path = self.get_im_client_path()

        base_dir = os.path.dirname(__file__)
        file_path = os.path.abspath(os.path.join(base_dir, '..', 'infrastructuresList.json'))

        try:
            with open(file_path) as f:
                data = json.load(f)
        except FileNotFoundError:
            print(f"File not found: {file_path}")
            return

        # Iterate through each infrastructure
        for infrastructure in data.get('infrastructures', []):
            infrastructure_info = {
                'Name': infrastructure.get('name', ''),
                'InfrastructureID': infrastructure.get('infrastructureID', ''),
                'IP': "",
                'State': ""
            }

            try:
                self.create_auth_pipe(infrastructure_info['InfrastructureID'])
            except ValueError as e:
                print(e)
                return "Failed"

            cmd_getstate = [
                'python3',
                im_client_path,
                'getstate',
                infrastructure_info['InfrastructureID'],
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            try:
                # Run the command, capturing stdout
                result = run(cmd_getstate, stdout=PIPE, stderr=PIPE, check=True, text=True)
                state_output = result.stdout
                state_words = state_output.split()
                state_index = state_words.index("state:") if "state:" in state_words else -1

                if state_index != -1 and state_index < len(state_words) - 1:
                    state = state_words[state_index + 1].strip()
                    infrastructure_info['State'] = state
                else:
                    infrastructure_info['State'] = "Error: State not found"

            except CalledProcessError as e:
                infrastructure_info['State'] = f"Error: {e.output.strip()}"

            cmd_getvminfo = [
                'python3',
                im_client_path,
                'getvminfo',
                infrastructure_info['InfrastructureID'],
                '0',
                'net_interface.1.ip',
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            try:
                # Run the command, capturing stdout
                result = run(cmd_getvminfo, stdout=PIPE, stderr=PIPE, check=True, text=True)
                ip_output = result.stdout
                ip = ip_output.split()[-1].strip()
                infrastructure_info['IP'] = ip
            except CalledProcessError as e:
                infrastructure_info['IP'] = f"Error: {e.output.strip()}"

            infrastructures_list.append(infrastructure_info)

        # Convert infrastructures_list to a list of lists for tabulate
        infrastructure_data = [
            [infrastructure['Name'], infrastructure['InfrastructureID'], infrastructure['IP'], infrastructure['State']]
            for infrastructure in infrastructures_list
        ]

        # Print the information as a table using tabulate
        print(tabulate(infrastructure_data, headers=['Name', 'Infrastructure ID', 'IP', 'State'], tablefmt='grid'))

        # Clean up auth-pipe file
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')

        return

    @line_magic
    def apricot_info(self, line):
        if len(line) == 0:
            print("Usage: apricot_info infrastructure-id\n")
            return "Fail"

        im_client_path = self.get_im_client_path()

        # Split the input line to extract the infrastructure ID
        inf_id = line.split()[0]

        try:
            # Create auth-pipe for the specified infrastructure
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Construct the command to retrieve log messages
        cmd_getinfo = [
            "python3",
            im_client_path,
            "getinfo",
            inf_id,
            "-a",
            "auth-pipe",
            "-r",
            "https://im.egi.eu/im",
        ]

        try:
            # Run the command, capturing stdout and stderr
            result = run(cmd_getinfo, stdout=PIPE, stderr=PIPE, check=True, text=True)
            print(result.stdout)
        except CalledProcessError as e:
            # Handle errors raised by the command
            print("Status: fail " + str(e.returncode) + "\n")
            print(e.stderr + "\n")
            print(e.stdout)
            return "Fail"
        finally:
            # Clean up auth-pipe file
            if os.path.exists('auth-pipe'):
                os.remove('auth-pipe')

    @line_magic
    def apricot_vmls(self, line):
        if len(line) == 0:
            print("Usage: apricot_vmls infrastructure-id\n")
            return "Fail"

        im_client_path = self.get_im_client_path()

        # Split the input line to extract the infrastructure ID
        inf_id = line.split()[0]

        vm_info_list = []

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        cmd_getinfo = [
            'python3',
            im_client_path,
            'getinfo',
            inf_id,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        try:
            current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None

            # Execute command and capture output
            result = run(cmd_getinfo, stdout=PIPE, stderr=PIPE, check=True, text=True)
            state_output = result.stdout
            # Split the output by lines
            state_lines = state_output.split('\n')

            for line in state_lines:
                if line.startswith("Info about VM with ID:"):
                    current_vm_id = line.split(":")[1].strip()
                if line.strip().startswith("net_interface.1.ip ="):
                    ip_address = line.split("'")[1].strip()
                if line.strip().startswith("state ="):
                    status = line.split("'")[1].strip()
                if line.strip().startswith("provider.type ="):
                    provider_type = line.split("'")[1].strip()
                if line.strip().startswith("disk.0.image.url ="):
                    os_image = line.split("'")[1].strip()

                if all((current_vm_id, ip_address, status, provider_type, os_image)):
                    vm_info_list.append([current_vm_id, ip_address, status, provider_type, os_image])
                    # Reset variables for the next VM
                    current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None

        except CalledProcessError as e:
            print(f"Error: {e.output.strip()}")

        # Print the information as a table using tabulate
        print(tabulate(vm_info_list, headers=['VM ID', 'IP Address', 'Status', 'Provider', 'OS Image'], tablefmt='grid'))
        
        # Clean up auth-pipe file
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        
        return

    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0:
            print("Usage: apricot_upload infrastructure-id vm-id file1 file2 ... fileN remote-destination-path\n")
            return "Fail"
        
        words = line.split()
        if len(words) < 4:
            print("Usage: apricot_upload infrastructure-id vm-id file1 file2 ... fileN remote-destination-path\n")
            return "Fail"

        inf_id = words[0]
        vm_id = words[1]
        destination = words[-1]
        files = words[2:-1]

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call generate_key function to extract private key content and host IP
        private_key_content, hostIP = self.generate_key(inf_id, vm_id)

        if not private_key_content:
            print("Error: Unable to generate private key.")
            return "Failed"

        cmd_scp = [
            'scp',
            '-i', 'key.pem',
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
        ]

        # Add each file to the scp command
        for file in files:
            cmd_scp.extend(file)
        # Add the destination path to the scp command
        cmd_scp.append(f'root@{hostIP}:{destination}')

        # Execute scp command and capture output
        try:
            result = run(cmd_scp, stdout=PIPE, stderr=PIPE, check=True, text=True)
            print(result.stdout)
        except CalledProcessError as e:
            print(f"Error: {e.stderr}\n")

        # Clean up auth-pipe and key.pem files
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"
           
    @line_magic
    def apricot_download(self, line):
        if len(line) == 0:
            print("Usage: apricot_download infrastructure-id vm-id file1 file2 ... fileN local-destination-path\n")
            return "Fail"
        
        words = line.split()
        if len(words) < 4:
            print("Usage: apricot_download infrastructure-id vm-id file1 file2 ... fileN local-destination-path\n")
            return "Fail"

        inf_id = words[0]
        vm_id = words[1]
        destination = words[-1]
        files = words[2:-1]

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call generate_key function to extract private key content and host IP
        private_key_content, hostIP = self.generate_key(inf_id, vm_id)

        if not private_key_content:
            print("Error: Unable to generate private key.")
            return "Failed"

        cmd_scp = [
            'scp',
            '-i', 'key.pem',
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
        ]

        # Add each remote file to the scp command
        for file in files:
            cmd_scp.append(f'root@{hostIP}:{file}')

        # Add the local destination path to the scp command
        cmd_scp.append(destination)

        # Execute scp command and capture output
        try:
            result = run(cmd_scp, stdout=PIPE, stderr=PIPE, check=True, text=True)
            print(result.stdout)
        except CalledProcessError as e:
            print(f"Error: {e.stderr}\n")

        # Clean up auth-pipe and key.pem files
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"

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

        if word1 in {"exec", "execAsync"}:
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
                
                # Call generate_key function to extract private key content and host IP
                private_key_content, host_ip = self.generate_key(inf_id, vm_id)

                if not private_key_content:
                    print("Error: Unable to generate private key. Missing infrastructure ID or VM ID.")
                    return "Failed"

                cmd_ssh = ['ssh', '-i', 'key.pem', '-o', 'StrictHostKeyChecking=no', f'root@{host_ip}'] + cmd_command

                try:
                    result = run(cmd_ssh, stdout=PIPE, stderr=PIPE, universal_newlines=True)
                    if result.returncode == 0:
                        print(result.stdout)
                        if word1 == "execAsync":
                            return "Done"
                    else:
                        print(f"Status: fail {result.returncode}\n")
                        print(result.stderr + "\n")
                        return "Fail"
                except CalledProcessError as e:
                    print(f"Error: {e}")
                    return "Fail"
                finally:
                    if os.path.exists('auth-pipe'):
                        os.remove('auth-pipe')
                    if os.path.exists('key.pem'):
                        os.remove('key.pem')

        elif word1 == "list":
            return self.apricot_ls()

        elif word1 == "destroy":
            # Check if only one argument is provided (the infrastructure ID)
            if len(words) != 2:
                print("Usage: destroy infrastructure-id")
                return "Fail"
            else:
                im_client_path = self.get_im_client_path()
                inf_id = words[1]

                try:
                    self.create_auth_pipe(inf_id)
                except ValueError as e:
                    print(e)
                    return "Failed"

                cmd_destroy = [
                    'python3',
                    im_client_path,
                    'destroy',
                    inf_id,
                    '-r',
                    'https://im.egi.eu/im',
                    '-a',
                    'auth-pipe',
                ]

                try:
                    print("Destroying...\nPlease wait, this may take a few seconds.", end='', flush=True)
                    result = run(cmd_destroy, stdout=PIPE, stderr=PIPE, universal_newlines=True)
                    log = result.stdout
                    std_err = result.stderr

                    # Clear the message
                    print("\r" + " " * len("Destroying...\nPlease wait, this may take a few seconds."), end='', flush=True)
                    print("\r", end='', flush=True)
                    
                    if log:
                        print(log)
                    if std_err:
                        print(std_err)

                    if result.returncode != 0:
                        return "Fail"

                    # Load infrastructure list from JSON file
                    base_dir = os.path.dirname(__file__)
                    file_path = os.path.abspath(os.path.join(base_dir, '..', 'infrastructuresList.json'))

                    # Load infrastructure list from JSON file
                    try:
                        with open(file_path, 'r') as f:
                            data = json.load(f)
                    except FileNotFoundError:
                        print(f"File not found: {file_path}")
                        return "Failed"
                    except json.JSONDecodeError:
                        print(f"Error decoding JSON from file: {file_path}")
                        return "Failed"

                    # Find and remove the infrastructure with the specified ID
                    for infrastructure in data['infrastructures']:
                        if infrastructure['infrastructureID'] == inf_id:
                            data['infrastructures'].remove(infrastructure)
                            break

                    base_dir = os.path.dirname(__file__)
                    file_path = os.path.abspath(os.path.join(base_dir, '..', 'infrastructuresList.json'))

                    # Write the updated infrastructure list back to the JSON file
                    try:
                        with open(file_path, 'w') as f:
                            json.dump(data, f, indent=4)
                    except IOError as e:
                        print(f"Error writing to file {file_path}: {e}")
                        return "Failed"

                except CalledProcessError as e:
                    print(f"Error: {e}")
                    return "Failed"
                finally:
                    if os.path.exists('auth-pipe'):
                        os.remove('auth-pipe')

                return "Done"

        return "Done"

def load_ipython_extension(ipython):
    """
    Any module file that define a function named `load_ipython_extension`
    can be loaded via `%load_ext module.path` or be configured to be
    autoloaded by IPython at startup time.
    """
    ipython.register_magics(Apricot_Magics)
