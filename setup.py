from setuptools import setup, find_packages

setup(
    name='apricot_magics',
    version='0.1.0',
    packages=find_packages(),  # Automatically find the `apricot_magics` package
    install_requires=[
        'ipython>=8.0.0',
    ],
    entry_points={
        'ipython.plugins': [
            'apricot_magics = apricot_magics.apricot_magics'
        ]
    },
    include_package_data=True,
    package_data={
        '': ['*.py'],
    },
    zip_safe=False
)
