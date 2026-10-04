# WebAppGen - Desktop App Generator for Websites
# Multi-platform packaging container for Linux (AppImage, DEB, RPM) and Windows (.exe)
FROM node:20-bookworm

# Set non-interactive debian frontend
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies required by electron-builder and tauri
# for building AppImage, DEB, RPM, and Windows executables
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libwebkit2gtk-4.0-dev \
    libwebkit2gtk-4.1-dev \
    rpm \
    file \
    libarchive-tools \
    libfuse2 \
    fuse \
    wine \
    wine64 \
    curl \
    wget \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain for Tauri
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal \
    && chmod -R a+w /usr/local/rustup /usr/local/cargo \
    && npm install -g @tauri-apps/cli

# Set up working directory
WORKDIR /app

# Configure Electron and Electron-Builder cache directories for persistence
ENV ELECTRON_CACHE=/app/.electron-cache
ENV ELECTRON_BUILDER_CACHE=/app/.electron-builder-cache
ENV PORT=3000

# Clone repository from GitHub
ARG REPO_URL=https://github.com/asabino2/webappgen.git
ARG BRANCH=main
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} .

# Install npm dependencies
RUN npm install

# Create persistent storage directories
RUN mkdir -p /app/builds /app/.electron-cache /app/.electron-builder-cache

# Expose web server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/info || exit 1

# Start the application
CMD ["node", "server.js"]
