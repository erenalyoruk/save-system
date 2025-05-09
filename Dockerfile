# Use an official Node.js runtime as a parent image
# Using Alpine Linux for a smaller image size. Consider a -slim variant if you encounter issues with native modules.
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and package-lock.json (or npm-shrinkwrap.json) first
# This leverages Docker cache. If these files don't change, Docker won't re-run npm install.
COPY package*.json ./

# Install dependencies. If you have native dependencies that require build tools,
# you might need to install them first (e.g., apk add --no-cache python3 make g++). 
# For this project, it should be fine.
RUN npm install --production
# If you also want devDependencies for some reason in the image (e.g., for running tests within the image):
# RUN npm install 

# Bundle app source
COPY . .

# Your app binds to port 3000 (or whatever is in your .env PORT)
# Expose the port. This is documentation; you still need to map it when running the container.
EXPOSE ${PORT:-3000}

# Define the command to run your app using CMD which defines the runtime.
# Using npm start which should execute "node server.js" as per your package.json
CMD [ "npm", "start" ] 