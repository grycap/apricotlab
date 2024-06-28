#Download base image ubuntu 18.04
FROM ubuntu:22.04

# Set root user
USER root

# Update Ubuntu Software repository and install python, jupyter lab and git
RUN apt-get update && \
    apt-get install -y \
        curl \
        python3 \
        python3-pip \
        git \
    && \
    python3 -m pip install --upgrade pip && \
    python3 -m pip install \
        jupyterlab \
        IM-client

# Optional: Clean up package cache to reduce image size
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create the script to init jupyter lab
RUN echo "#!/bin/bash" > /bin/jupyter-apricot && \
    echo "jupyter lab --ip 0.0.0.0 --no-browser" >> /bin/jupyter-apricot && \
    chmod +x /bin/jupyter-apricot

# Create a user for jupyter lab
RUN useradd -ms /bin/bash jupyteruser

# Change to jupyter lab user
USER jupyteruser
WORKDIR /home/jupyteruser

# Clone git, install, get the examples and clear files
#RUN git clone https://github.com/grycap/apricotlab.git && cd /home/jupyteruser/apricot 
#\
#    && sh install.sh && cd /home/jupyteruser && cp -r apricot/examples . && mv apricot .apricot_git

# Set entry point
ENTRYPOINT ["/bin/jupyter-apricot"]
