.. raw:: html

    <div align="center">

        <!-- Logo Banner or Transparent Icon -->
        <a href="https://github.com/physiomelinks/PhLynx">
            <img 
                src="public/phlynxlogo.svg" 
                alt="PhLynx Logo" 
                width="180" 
                style="filter: drop-shadow(0px 0px 8px rgba(255, 255, 255, 0.49));"
            >
            </a>

        <!-- Main Title (Using styled <p> to prevent the bottom border/line) -->
        <p align="center">
            <strong style="font-size: 2.25em;">PhLynx</strong>
        </p>

        <!-- Badges directly below title without any separating line -->
        <p align="center">
            <a href="https://github.com/physiomelinks/PhLynx/releases/latest">
            <img src="https://img.shields.io/github/v/release/physiomelinks/PhLynx?label=release&style=flat-square" alt="Latest Release">
            </a>
            <a href="https://github.com/physiomelinks/PhLynx/blob/main/LICENSE">
            <img src="https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square" alt="License">
            </a>
        </p>

    </div>

=======================
Physiome Links (PhLynx)
=======================

Physiome Links (PhLynx - pronounced "flinks") is a web-based graphical interface for coupling existing CellML components into a single system model.
Common use cases include generating coupled biophysical cell models and patient-specific blood and/or lymph flow networks.

Getting Started
---------------
PhLynx is a web application - no installation required. Simply access it through your web browser, and start building models immediately. The latest state of the application can be accessed online at: https://phlynx.com/

Browser Requirements:
~~~~~~~~~~~~~~~~~~~~~
* Chrome, Firefox, Safari, or Edge (latest versions recommended)
* JavaScript enabled
* Pop-up blocker disabled for file downloads

.. note:: 

    Using Chrome will enable users to specify file download location.


About PhLynx
------------
PhLynx is a web application for visually constructing and configuring CellML system models from CellML modules.

Built with Vue 3 and Electron, PhLynx provides a node-based interface
(powered by Vue Flow) that allows users to drag, drop, and connect different modular
physiological components. It is designed to work with CellML models
(using ``vue3-libcellml.js``) and exports flattened CellML (2.0) models for use with 
web OpenCOR or system configurations (JSON, CSV) for use with the Circulatory
Autogen software.

Features
--------

* **Visual, Node-Based Editor:** Drag and drop components to build complex models.
* **CellML Integration:** Based on ``vue3-libcellml.js`` for working with CellML files.
* **Workflow Management:** Save and load your visual workflow as a JSON file.
* **Model Export:** Export your model to formats compatible with Circulatory Autogen.
* **Web-based:** Runs on macOS, Windows, and Linux in any browser.

For Developers
------------------

This guide is for developers who wish to run or build the application from
the source code.

Prerequisites
~~~~~~~~~~~~~

* Node.js (v20 or later recommended)
* A package manager (npm or yarn)

Installation
~~~~~~~~~~~~

Clone the repository and install the dependencies:

.. code-block:: bash

    git clone https://github.com/physiomelinks/phlynx.git
    cd phlynx
    yarn install

Development
~~~~~~~~~~~

Use the following command to launch the app in your browser 
with hot-reloading for the Vue frontend.

.. code-block:: bash

    yarn dev

Per-variable ``multi_port``
~~~~~~~~~~~~~~~~~~~~~~~~~~~

A port's ``multi_port`` may be ``True``, ``sum`` or ``multiply`` (any case), or a list with one entry per port variable,
for example ``{"port_type": "vessel_port", "variables": ["v_in", "u"], "multi_port": ["sum", "True"]}``.
A port with a list accepts any number of connections.
A ``sum`` variable is the sum, over every connected module, of the neighbour's corresponding port variable
(0, with a warning, when nothing is connected); a ``True`` variable is shared with every connected module.
This matches circulatory_autogen. The list is shown, but not editable, in the port editors, and is exported unchanged.

Deployment
~~~~~~~~~~

To build the application for production, use the following command:

.. code-block:: bash

    yarn build

This will create a production-ready build in the ``dist`` directory.
We can also use the `update:docs:changelog` script to generate the complete changelog before building the application:

.. code-block:: bash

    yarn update:docs:changelog
    yarn build

To update the changelogs in the changelogs/ directory based on linked pull requests issue information we have to run:

..  code-block:: bash

    # For a specific range.
    yarn gen-changelog -q --from v0.2.0 --to v0.2.1
    # For all since the last tag.
    yarn gen-changelog -q

This will generate markdown to the terminal and this will need to be saved in the changelogs/ directory under the to version number (v0.2.1.md if following on from the command given above) or latest.md if not generating a specific version.

Testing
~~~~~~~

Create a Python virtual environment and install the required packages:

.. code-block:: bash

    python3 -m venv venv
    source venv/bin/activate
    pip install -r tests/requirements.txt

Then prepare playwright for testing by running the following command:

.. code-block:: bash

    playwright install --with-deps chromium

Create a .env.local file in the root directory (or the tests directory) of the project and add the following line to specify the base URL for testing:

.. code-block:: bash

    PHLYNX_BASE_URL=http://localhost:5173

Adding this line to the .env.local file will override the default base URL and allow the tests to run against the local development server.
If you want to run the tests against a different URL, simply change the value of PHLYNX_BASE_URL accordingly.

The default environment variables set in the tests/.env file are:

.. code-block:: bash

    HEADLESS_MODE=True
    PHLYNX_BASE_URL=http://localhost:5173

Then run the tests using the following command:

.. code-block:: bash

    # Run all tests
    python tests/run_playwright_tests.py

To generate Playwright test code for a specific URL, use the following command:

.. code-block:: bash

    playwright codegen --target python http://localhost:5173

We can use the `--output` option to save the generated code to a file and then edit it as needed. For example:

.. code-block:: bash

    playwright codegen --target python --output tests/playwright/test_generated.py http://localhost:5173

We can then adapt the generated code to create a Python unittest test that can be run from the `run_playwright_tests.py` script in the `tests` directory.

An alternative method is to use the `convert_codegen.py` script to convert the generated code to a unittest test. For example:

.. code-block:: bash
    
    python tests/convert_codegen.py \
        --input tests/playwright/test_generated.py \
        --output tests/playwright/test_documentation.py \
        --class DocumentationNavigation \
        --test documentation_navigation

This script will create a new test class called `TestDocumentationNavigation` in the `test_documentation.py` file, with a test method called `test_documentation_navigation`.
The script will create this file if it does not already exist.
Also, if the specified class already exists in the output file, the script will add the new test method to that class.
If the specified test method already exists in the class, the script will throw an error to avoid overwriting existing code.
If the specified class does not exist in the output file, the script will create a new class with the specified name and add the test method to it.

Release Process
~~~~~~~~~~~~~~~

First update the version number in **package.json** and commit the change.
Then tag the commit with the new version number, e.g. v0.2.1.
Use an annotated tag with a message describing the release, e.g.:

.. code-block:: bash

    git tag -a v0.2.1 -m "Release version 0.2.1"

Then push the commit and tag to the **main** branch of the `definitive remote repository <https://github.com/physiomelinks/phlynx>`_.

Next, prepare a staging pull request on GitHub using this `GitHub action <https://github.com/physiomelinks/phlynx/actions/workflows/prepare-staging.yml>`_.

When the staging pull request has been created, check the staged changes, changelog, and any other relevant information, then merge the pull request to the production branch.

Finally, check https://phlynx.com to ensure the new version is live and working as expected.

Following this process will create an official release of PhLynx and update the online version of the application.
You can also release an unofficial version of PhLynx by following this process but skipping changing the version number in **package.json** and creating a new tag.
