FROM ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    VENV_PATH=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    jq \
    sshpass \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create and activate a virtual environment
RUN python3 -m venv $VENV_PATH

# Install packages in the virtual environment
RUN pip install --upgrade pip \
    jupyterlab \
    IM-client \
    tabulate \
    requests \
    PyJWT

# Install Node.js v22, Yarn globally and clean up APT cache
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && npm install -g yarn \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /home/apricotlab/

# Install the Jupyter Notebook extension
RUN git clone https://github.com/grycap/apricotlab /home/apricotlab
RUN pip install -ve .

# Expose port 8888 (default port for Jupyter Lab)
EXPOSE 8888/tcp

# Start JupyterLab
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root"]
