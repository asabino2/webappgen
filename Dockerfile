# WebAppGen - Desktop App Generator for Websites
# Multi-platform packaging container for Linux (AppImage, DEB, RPM) and Windows (.exe)
FROM node:20-bookworm

# Set non-interactive debian frontend
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies required by electron-builder for building
# AppImage, DEB, RPM, and Windows executables
RUN apt-get update && apt-get install -y --no-install-recommends \
    rpm \
    file \
    libarchive-tools \
    libfuse2 \
    fuse \
    wine \
    wine64 \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
