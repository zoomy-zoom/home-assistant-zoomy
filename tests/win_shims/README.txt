Stand-ins for two POSIX-only modules (fcntl, resource) that Home Assistant's
runner imports. Home Assistant does not run on Windows; these exist only so
pytest-homeassistant-custom-component can be imported on a Windows PC.
run_tests.py puts this folder on PYTHONPATH on Windows only.
