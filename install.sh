
#!/bin/bash

#Create IM Client YAML template file (just in case)
mkdir -p $HOME/.imclient/templates

#Install and enable plugin content
if jupyter pip install apricot; then
    echo -e "Plugin installed."
    
else

    echo -e "Plugin installation failed!"
    exit 2
fi

if jupyter nbextension enable apricot_plugin/main; then
    echo -e "Plugin enabled."
    
else

    echo -e "Fail enabling plugin!"
fi

#Install apricot magics (python3)
if python3 -m pip install --find-links=file:apricot_magic/ apricot_magic/; then

    echo -e "magics succesfuly installed"
    
else
    echo -e "Unable to install apricot magics with python3"
fi