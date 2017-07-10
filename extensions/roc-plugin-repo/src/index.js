import fs from 'fs';
import * as validators from 'roc/validators';
import log from 'roc/log/default/small';
import readPkg from 'read-pkg';
import { lazyFunctionRequire } from 'roc';

import { invokeHook } from './util';
import { config, meta } from './config';

const lazyRequire = lazyFunctionRequire(require);

function getProjects(baseDirectory, directory) {
  if (!fs.existsSync(`${baseDirectory}/${directory}`)) {
    return [];
  }

  return fs
    .readdirSync(`${baseDirectory}/${directory}`)
    .map(project => {
      if (
        fs.existsSync(`${baseDirectory}/${directory}/${project}/package.json`)
      ) {
        const path = `${baseDirectory}/${directory}/${project}`;
        const packageJSON = readPkg.sync(`${path}/package.json`);
        return {
          folder: project,
          path,
          name: packageJSON.name,
          packageJSON,
        };
      }
      return undefined;
    })
    .filter(project => project !== undefined);
}

function fetchProjects(command) {
  return command(invokeHook('get-projects'));
}

const jestOptions = require('jest-cli/build/cli/args').options;

Object.keys(jestOptions).forEach(key => {
  if (jestOptions[key].type === 'boolean') {
    jestOptions[key].validator = validators.isBoolean;
  } else if (jestOptions[key].type === 'string') {
    jestOptions[key].validator = validators.isString;
  } else if (jestOptions[key].type === 'array') {
    jestOptions[key].validator = validators.isArray(validators.isPath);
  }
  // Remove aliases that are used by Roc to avoid collisions
  if (['b', 'c', 'd', 'h', 'V', 'v'].indexOf(jestOptions[key].alias) > -1) {
    jestOptions[key].alias = undefined;
  }
});

module.exports.roc = {
  plugins: [require.resolve('roc-plugin-babel')],
  hooks: {
    'get-projects': {
      description: 'Gets all projects.',
      returns: validators.isArray(validators.isObject()),
    },
    'babel-config': {
      description: 'Used to create a Babel configuration to be used.',
      initialValue: {},
      returns: validators.isObject(),
      arguments: {
        target: {
          validator: validators.isString,
          description: 'The target, will by default be either "cjs" or "esm".',
        },
      },
    },
    'release-preconditions': {
      description: 'Release preconditions.',
      initialValue: [],
      arguments: {
        toRelease: {
          description: 'Projects that will be released',
          validator: validators.isArray(validators.isString),
        },
        Listr: {
          description: 'Listr instance',
        },
      },
    },
    'release-after-build': {
      description: 'Extra tasks to do before releasing, after building.',
      initialValue: [],
      arguments: {
        toRelease: {
          description: 'Projects that will be released',
          validator: validators.isArray(validators.isString),
        },
        Listr: {
          description: 'Listr instance',
        },
      },
    },
  },
  actions: [
    {
      hook: 'get-projects',
      action: ({
        context: { directory, config: { settings } },
      }) => () => () => {
        if (settings.repo.mono === false) {
          if (fs.existsSync(`${directory}/package.json`)) {
            const packageJSON = readPkg.sync(`${directory}/package.json`);
            return [
              {
                folder: directory,
                path: directory,
                name: packageJSON.name,
                packageJSON,
              },
            ];
          }

          return [];
        }

        // Look for things in either of these directories
        return settings.repo.mono.reduce(
          (previous, dir) => previous.concat(getProjects(directory, dir)),
          [],
        );
      },
    },
    {
      hook: 'babel-config',
      description:
        'Adds babel-preset-latest with either modules enabled or not depending on the target',
      action: () => target => babelConfig =>
        Object.assign({}, babelConfig, {
          presets:
            target === 'cjs'
              ? [
                  ...babelConfig.presets,
                  require.resolve('babel-preset-env'),
                  require.resolve('babel-preset-stage-3'),
                ]
              : [
                  [require.resolve('babel-preset-env'), { modules: false }],
                  require.resolve('babel-preset-stage-3'),
                  ...babelConfig.presets,
                ],
        }),
    },
  ],
  config,
  meta,
  commands: {
    repo: {
      bootstrap: {
        command: args =>
          fetchProjects(lazyRequire('./commands/bootstrap'))(args),
        description: 'Installs and links the projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          extra: {
            description: 'Modules that should be linked into the projects',
            validator: validators.isArray(validators.isString),
          },
        },
      },
      build: {
        command: args => fetchProjects(lazyRequire('./commands/build'))(args),
        description: 'Builds projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          watch: {
            validator: validators.isBoolean,
            description: 'Enabled watch mode',
          },
        },
      },
      clean: {
        command: args => fetchProjects(lazyRequire('./commands/clean'))(args),
        description: 'Cleans generated files',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
      },
      commit: {
        command: require('./commands/commit'),
        description:
          'Use commitizen when doing a commit, pass arguments with --',
        settings: true,
      },
      lint: {
        command: args => fetchProjects(lazyRequire('./commands/lint'))(args),
        description: 'Runs lint',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          fix: {
            validator: validators.isBoolean,
            description: 'Use ESLint --fix option',
          },
          forceDefault: {
            validator: validators.isBoolean,
            description: 'Force use of default ESLint configuration',
            default: false,
          },
        },
      },
      list: {
        description:
          'List the projects that will be used when running the commands',
        settings: true,
        command: () =>
          fetchProjects(projects => {
            if (projects.length === 0) {
              return log.log('Nothing found.');
            }

            return log.log(
              `Found the following:\n${projects
                .map(project => ` — ${project.name}`)
                .join('\n')}`,
            );
          }),
      },
      release: {
        command: args => fetchProjects(lazyRequire('./commands/release'))(args),
        description: 'Perform a release',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          clean: {
            validator: validators.isBoolean,
            default: true,
            description: 'If the project should be cleaned',
          },
          git: {
            validator: validators.isBoolean,
            default: true,
            description: 'If project commits should be created',
          },
          push: {
            validator: validators.isBoolean,
            default: true,
            description: 'If commits should be pushed to the remote',
          },
          publish: {
            validator: validators.isBoolean,
            default: true,
            description: 'If projects should be published',
          },
          tag: {
            validator: validators.isString,
            default: 'latest',
            description: 'dist-tag to be used when publishing',
          },
        },
      },
      rnm: {
        command: args =>
          fetchProjects(lazyRequire('./commands/removeNodeModules'))(args),
        description: 'Removes node_modules folders in projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
      },
      run: {
        command: args => fetchProjects(lazyRequire('./commands/run'))(args),
        description: 'Run npm scripts in projects.',
        arguments: {
          command: {
            validator: validators.isString,
            description: 'The command to invoke',
          },
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          list: {
            description: 'Lists possible commands',
            default: false,
            validator: validators.isBoolean,
          },
        },
        settings: ['mono'],
      },
      status: {
        command: args => fetchProjects(lazyRequire('./commands/status'))(args),
        description: 'Generate status about release state for projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
      },
      test: {
        command: args => fetchProjects(lazyRequire('./commands/test'))(args),
        description: 'Run tests using Jest',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: jestOptions,
      },
      unlink: {
        command: args => fetchProjects(lazyRequire('./commands/unlink'))(args),
        description: 'Unlinks up the projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
      },
    },
  },
};
