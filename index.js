#!/usr/bin/env node

import { program } from 'commander';
import { readFile } from 'fs/promises';
import inquirer from 'inquirer';
import colors from 'colors';
import shell from 'shelljs';
import jsonpack from 'jsonpack/main.js';
// import { compress, decompress } from 'lzw-compressor';
import { folderExists, getFileContent, getRelativePath } from './utils/files.js';

import {
	addBoilerplate,
	getBoilerplates,
	getSettings,
	removeBoilerplate,
	updateBoilerplate,
} from './utils/settings.js';
import { printBoilerplatesTable, printMsg } from './utils/ui.js';
import { cloneRepository } from './utils/repo.js';
import faber from './utils/faber.js';
import { runActions } from './utils/actions.js';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url)));

const options = program.opts();

program
	.name('faber')
	.description('A CLI for creating projects from custom boilerplates.')
	.version(pkg.version, '-v, --version', 'Output the installed version of the CLI');

program
	.command('create')
	.arguments('<name>')
	.option('--simulate', 'Log the possible changes without modifying any file.')
	.option(
		'--keep-git',
		'Prevent removal of the .git folder. Useful to check what has changed on the original boilerplate.'
	)
	.option('--use-existing', 'Skip the prompt to use existing folder. Useful when developing')
	.description('Create a new project with a configured boilerplate.')
	.action(async (name, options) => {
		try {
			// Check if git is installed
			if (!shell.which('git') && !options.useExisting) {
				printMsg(`Sorry, this script requires git.`, 'error');
				printMsg(`Make sure you have git installed and available before running this command.`, '', ' ');
				shell.exit(1);
			}

			// Check if folder already exists
			if (folderExists(name) && !options.useExisting) {
				printMsg(`There is already a folder named \`*${name}*\` on this directory.`, 'warn');
				const { proceedWithExistingFolder } = await inquirer.prompt({
					type: 'confirm',
					name: 'proceedWithExistingFolder',
					message: `Do you want to continue with this folder?`,
					suffix: ` (git clone will be skipped)`,
					default: false,
				});

				if (!proceedWithExistingFolder) {
					printMsg(`Operation cancelled`, 'muted');
					shell.exit(0);
				}
			}

			// Get registered boilerplates
			const boilerplates = await getBoilerplates();
			const { boilerplate } = await inquirer.prompt([
				{
					type: 'list',
					name: 'boilerplate',
					message: `Choose a boilerplate:`,
					choices: boilerplates.map((b) => ({ name: `${b.name} ${colors.gray(`(${b.repo})`)}`, value: b.alias })),
					filter: (alias) => boilerplates.find((b) => b.alias === alias),
				},
			]);

			try {
				// const repoDetails = gitUrlParse('https://gitlab.com/gpc-dev/desenrolla');
				// repoDetails.git_suffix = true;
				// repoDetails.filepath = 'README.md';
				// console.log(repoDetails.toString());
				await cloneRepository(boilerplate.repo, name);
			} catch (err) {
				console.log(err);
				printMsg(
					`Sorry, it seems that a problem occurred during the process. See the logs above for more details.`,
					'error'
				);
			}
		} catch (error) {
			console.error(error);
		}
	});

program
	.command('run')
	.option('--dry', 'Run commands without making any changes')
	.option('--data', 'Encoded JSON data to be passed to the script')
	.option('--no-preview', 'Do not show the JSON data preview')
	.description('Run the script inside the current repository (usually for development)')
	.action(async () => {
		const config = await import(getRelativePath('faberconfig.js'));
		config.default(faber);

		// Get project data
		/* const testData = {
			projectName: 'Greenpark',
			clientName: 'Unilever',
			projectUrl: 'https://greenpark.digital/',
			isMultisite: true,
		};
		const jsonStr = JSON.stringify(testData, null);
		const compressed = jsonpack.pack(jsonStr);
		const bytes = Buffer.from(compressed).length; */

		// Request JSON data
		const { json } = await inquirer.prompt([
			{
				type: 'input',
				name: 'json',
				message: `Paste the project data`,
				suffix: ` (minified JSON):`.grey,
				validate: (input) => {
					let json = {};
					try {
						json = JSON.parse(input);
					} catch (err) {
						return (
							` The provided data doesn't seem to be a valid JSON.`.red +
							` Make sure the JSON is minified and in one single line.`.red
						);
					}
					return true;
				},
			},
		]);

		const data = JSON.parse(json);

		// Run boilerplate actions
		const results = await runActions(faber.actions(data));
		console.log(results);
	});

const addArgs = '<boilerplate> <repository> [name]';
program
	.command('add')
	.arguments(addArgs)
	.description('Add a boilerplate repository to your list of available boilerplates.')
	.action(async (alias, repo, name) => {
		try {
			const settings = await getSettings();

			if (!settings.hasOwnProperty('boilerplates')) {
				settings.boilerplates = [data];
				return;
			}

			const data = { alias, repo, name: name ? name : '' };

			const existingBoilerplate = settings.boilerplates.find((b) => b.alias === alias);
			if (existingBoilerplate) {
				printMsg(`A boilerplate with alias *${alias}* already exists:`, 'error');
				printBoilerplatesTable([existingBoilerplate]);

				const { shouldUpdate } = await inquirer.prompt([
					{
						type: 'confirm',
						name: 'shouldUpdate',
						message: 'Do you want to update this boilerplate?',
						default: false,
					},
				]);

				shouldUpdate && (await updateBoilerplate(alias, data));
				return;
			}

			await addBoilerplate(data);
		} catch (error) {
			console.error(error);
		}
	});

program
	.command('ls')
	.description('List all configured boilerplates.')
	.action(async () => {
		try {
			const boilerplates = await getBoilerplates();
			if (!boilerplates.length) {
				printMsg('There are no boilerplates to list\n', 'error');
				printMsg(`You can add a boilerplate with: faber add ${addArgs}\n`, 'info');
				return;
			}

			printBoilerplatesTable(boilerplates);
		} catch (error) {
			console.error(error);
		}
	});

program
	.command('rm <boilerplate>')
	.description('Remove a configured boilerplate.')
	.action(async (alias) => {
		try {
			const settings = await getSettings();

			if (!settings.hasOwnProperty('boilerplates')) {
				printMsg(`There are no boilerplates configured`, 'error');
				return;
			}

			if (!settings.boilerplates.find((b) => b.alias === alias)) {
				printMsg(`No boilerplate found with alias *${alias}*`, 'error');
				return;
			}

			removeBoilerplate(alias);
		} catch (error) {
			console.error(error);
		}
	});

program.parse();
