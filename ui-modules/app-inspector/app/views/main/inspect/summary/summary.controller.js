/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import angular from "angular";
import map from "lodash/map";
import {HIDE_INTERSTITIAL_SPINNER_EVENT} from 'brooklyn-ui-utils/interstitial-spinner/interstitial-spinner';
import template from "./summary.template.html";
import { SENSITIVE_FIELD_REGEX } from 'brooklyn-ui-utils/sensitive-field/sensitive-field';

export const summaryState = {
    name: 'main.inspect.summary',
    url: '/summary',
    template: template,
    controller: ['$scope', '$state', '$stateParams', '$q', '$http', '$httpParamSerializer', 'brSnackbar', 'entityApi', 'locationApi', 'iconService', summaryController],
    controllerAs: 'vm'
};

export function summaryController($scope, $state, $stateParams, $q, $http, $httpParamSerializer, brSnackbar, entityApi, locationApi, iconService) {
    $scope.$emit(HIDE_INTERSTITIAL_SPINNER_EVENT);

    const {
        applicationId,
        entityId
    } = $stateParams;

    this.error = {};

    let vm = this;
    vm.activitiesInError = [];
    vm.sensorsToShow = {
        'service.state': 'Service status',
        'service.isUp': 'Service up',
        'service.problems': 'Service problem',
        'service.notUp.indicators': 'Service indicator'
    };
    // the eventual entries to share with the sensor table component
    vm.configItems = null;
    vm.configItemsInfo = null;

    let observers = [];

    entityApi.entity(applicationId, entityId).then((response)=> {
        let set = (response) => {
            vm.entity = response.data;
            vm.name = response.data.name;
            vm.error.entity = undefined;
            iconService.get(response.data, true).then(value => vm.iconUrl = value);
        };
        set(response);
        observers.push(response.subscribe(set));
    }).catch((error)=> {
        vm.error.entity = 'Cannot load entity with ID: ' + entityId;
    });

    vm.showResolvedConfig = false;

    function getConfigState(resolved=false) {
        return entityApi.entityConfigState(applicationId, entityId, {
            params: {
                suppressSecrets: true,
                skipResolution: !resolved,
            },
            paramSerializer: (params) => $httpParamSerializer({
                ...params,
                skipResolution: !resolved,
            }),
        });
    }

    function getConfigInfo() {
        return entityApi.entityConfigInfo(applicationId, entityId);
    }

    // no return
    vm.refreshConfig = () => {
        const handleError = (message) => {
            vm.error.configItems = message;
            vm.configItems = null;
            vm.configItemsInfo = null;
        }

        const successHandler = (key) => (response) => {
            vm[key] = response.data;
            vm.error.configItems = null;

            // TODO: ideally move this to a $watch block
            if (vm.config && vm.configResolved && vm.configInfo) {
                vm.configItems = Object.entries(vm.showResolvedConfig ? vm.configResolved : vm.config)
                    .map(([key, value]) => ({
                        key,
                        value,
                        // marking as unsafe if the field name looks sensitive
                        // and the unresolved value does *not* come from a secure external source
                        isUnsafe: SENSITIVE_FIELD_REGEX.test(key.trim()) &&
                            !vm.config[key].toString().startsWith('$brooklyn:'),
                    }));
            }
        }

        Promise.allSettled([getConfigState(), getConfigState(true), getConfigInfo()])
            .then(([configResult, configResolvedResult, configInfoResult]) => {
                if (configResult.status === 'rejected') {
                    handleError(`Could not load configuration for entity with ID: ${entityId}`);
                } else if (configResolvedResult.status === 'rejected') {
                    handleError(`Could not load resolved configuration for entity with ID: ${entityId}`);
                } else if (configInfoResult.status === 'rejected') {
                    handleError(`Could not load resolved configuration information for entity with ID: ${entityId}`);
                } else { // all 200-OK case
                    vm.error.configItems = undefined; // clearing error flag
                    // set configItems && configItemsInfo

                    const configHandler = successHandler('config');
                    const configResolvedHandler = successHandler('configResolved');
                    const configInfoHandler = successHandler('configInfo');

                    configHandler(configResult.value);
                    configResolvedHandler(configResolvedResult.value);
                    configInfoHandler(configInfoResult.value);

                    // making sure that changes are propagated to table.
                    $scope.$apply();
                }
            });
    }

    vm.refreshConfig();

    vm.toggleConfigResolved = () => {
        vm.showResolvedConfig = !vm.showResolvedConfig;
        vm.refreshConfig();
    }

    entityApi.entitySpecList(applicationId, entityId).then((response)=> {
        vm.specList = response.data;
        vm.specItem = vm.specList[0];
        vm.error.specList = undefined;
        observers.push(response.subscribe((response)=> {
            vm.specList = response.data;
            vm.error.specList = undefined;
        }));
    }).catch((error)=> {
        vm.error.specList = 'Cannot load spec map for entity with ID: ' + entityId;
    });

    entityApi.entityActivities(applicationId, entityId).then((response)=> {
        vm.activities = parseActivitiesResponse(response.data);
        vm.error.activities = undefined;
        observers.push(response.subscribe((response)=> {
            vm.activities = parseActivitiesResponse(response.data);
            vm.error.activities = undefined;
        }));
    }).catch((error)=> {
        vm.error.spec = 'Cannot load spec for entity with ID: ' + entityId;
    });

    entityApi.entitySensorsState(applicationId, entityId).then((response)=> {
        vm.sensors = response.data;
        vm.error.sensors = undefined;
        observers.push(response.subscribe((response)=> {
            vm.sensors = response.data;
            vm.error.sensors = undefined;
        }));
    }).catch((error)=> {
        vm.error.sensors = 'Cannot sensors for entity with ID: ' + entityId;
    });

    entityApi.entitySensorsInfo(applicationId, entityId).then((response)=> {
        vm.sensorsInfo = response.data;
        vm.error.sensors = undefined;
        observers.push(response.subscribe((response)=> {
            vm.sensorsInfo = response.data;
            vm.error.sensors = undefined;
        }));
    }).catch((error)=> {
        vm.error.sensors = 'Cannot sensors information for entity with ID: ' + entityId;
    });

    entityApi.entityPolicies(applicationId, entityId).then((response)=> {
        // vm.policies = response.data;
        // TODO: Replace once the new adjunct endpoint has been merged
        vm.policies = response.data.map(policy => {
            policy.type = 'policy';
            return policy;
        });
        vm.error.policies = undefined;
        observers.push(response.subscribe((response)=> {
            // vm.policies = response.data;
            // TODO: Replace once the new adjunct endpoint has been merged
            vm.policies = response.data.map(policy => {
                policy.type = 'policy';
                return policy;
            });
            vm.error.policies = undefined;
        }));
    }).catch((error)=> {
        vm.error.policies = 'Cannot load policies for entity with ID: ' + entityId;
    });

    $http.get('/v1/ui-metadata-registry', {params: {type: 'location'}}).then(response => {
        vm.metadata = response.data;
    });

    entityApi.entityLocations(applicationId, entityId).then(response => {
        parseLocationsResponse(response.data);
        observers.push(response.subscribe(response => {
            parseLocationsResponse(response.data);
        }));
    }).catch(error => {
        vm.error.location = 'Cannot load location for entity with ID: ' + entityId;
    });

    $scope.$on('$destroy', ()=> {
        observers.forEach((observer)=> {
            observer.unsubscribe();
        });
    });

    this.isObject = function(item) {
        return angular.isObject(item);
    };

    this.isEmpty = function(item) {
        if (angular.isObject(item)) {
            return Object.keys(item).length === 0;
        } else if (angular.isString(item)) {
            return item.length === 0;
        } else {
            return item === undefined || item === null;
        }
    };

    this.updateEntityName = function() {
        if (vm.name && vm.name !== vm.entity.name) {
            entityApi.updateEntityName(applicationId, entityId, this.name).then((response)=> {
                vm.entity.name = vm.name;
            }).catch((error)=> {
                let errorMessage= ('undefined' === typeof error.message)? error.error.message: error.message;
                brSnackbar.create('Cannot update entity name: ' + errorMessage);
                vm.name = vm.entity.name;
            });
        }
    };

    this.expandMultiLocation = () => {
        if (!vm.subLocations) {
            vm.subLocations = {
                requested: false
            };
        }

        if (!vm.subLocations.requested) {
            vm.subLocations.requested = true;
            $q.all(vm.location.multi.config.subLocations.map(subLocation => locationApi.location(subLocation.id))).then(responses => {
                vm.subLocations.items = responses.map(response => response.data);
            }).catch(error => {
                vm.error.subLocations = 'Cannot load sub-locations for entity with ID: ' + entityId;
            })
        }
    };

    function parseActivitiesResponse(data) {
        if (data) {

            let activities = angular.copy(vm.activitiesInError);

            map(data, (activityObject) => {
                if (activityObject.isError) {
                    let index = activities.findIndex(function (activity) {
                        return activity.displayName === activityObject.displayName;
                    });
                    if (index === -1) {
                        activities.push(activityObject);
                    }
                    else {
                        activities[index] = activityObject;
                    }
                }
            });

            vm.activitiesInError = activities.sort(function (a, b) {
                if (a.endTimeUtc > b.endTimeUtc) {
                    return 1;
                }
                if (a.endTimeUtc < b.endTimeUtc) {
                    return -1;
                }
                return a.displayName > b.displayName;
            }).reverse();

            vm.mostRecentActivityInError = vm.activitiesInError.length > 0 ? vm.activitiesInError[vm.activitiesInError.length - 1] : undefined;
        }
    }

    function parseLocationsResponse(data) {
        $q.all(data.map(location => locationApi.location(location.id))).then(responses => {
            vm.location = {
                items: responses.filter(item => item.data.config['spec.final'] !== 'multi').map(response => response.data)
            };

            let multi = responses.find(item => item.data.config['spec.final'] === 'multi');
            if (multi) {
                vm.location.multi = multi.data;
            }

            vm.error.location = undefined;
        }).catch(error => {
            vm.error.location = 'Cannot load location for entity with ID: ' + entityId;
        });
    }
}

export function specToLabelFilter() {
    return function(input, map) {
        if (map && map instanceof Object) {
            return map.hasOwnProperty(input) ? map[input].name : input;
        }
        return input;
    }
}
