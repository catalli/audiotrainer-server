//var events = require('events');
var fs = require('fs');
var chokidar = require('chokidar');
var csv = require('fast-csv');
var jsonfile = require('jsonfile');

var jsfft = require("jsfft");
var complex_array = require("./node_modules/jsfft/lib/complex_array.js");
var extractors = require("./node_modules/meyda/dist/node/featureExtractors.js");
var utils = require("./utils.js");
var meyda_utils = require("meyda").utils;

//var meyda = require('meyda');
//var AudioContext = require('web-audio-api').AudioContext;

var config = require('./config.json');

/*
function getSpectrum(_d) {
    var windowedSignal = meyda_utils.applyWindow(_d, 'hanning')
    // create complexarray to hold the spectrum
    var data = new complex_array.ComplexArray(_d.length)
    // map time domain
    data.map(function(value, i, n) {
        value.real = windowedSignal[i]
    });
    // transform
    var spec = data.FFT();
    // assign to meyda
    var ampSpectrum = new Float32Array(_d.length/2)
    for (var i = 0; i < _d.length/2; i++) {
        ampSpectrum[i] = Math.sqrt(Math.pow(spec.real[i],2) + Math.pow(spec.imag[i],2))
    }
    return ampSpectrum
}
*/

function getAvg(array) {
	var total = 0;
	for (var i = 0;i < array.length;i++) {
		total += array[i];
	}
	avg = total/array.length;
	return avg;
}

function getStdDev(array) {
	var avg = getAvg(array);
	totalDev = 0;
	for(var i = 0;i < array.length;i++) {
		totalDev += Math.pow((array[i] - avg),2)
	}
	stdDev = Math.sqrt(totalDev/(array.length-1))
	return stdDev;
}

function getCorrelation(array1, array2) {
	var avg1 = getAvg(array1);
	var avg2 = getAvg(array2);
	var stdDev1 = getStdDev(array1);
	var stdDev2 = getStdDev(array2);
	cov = 0;
	for(var i = 0;i < array1.length && i < array2.length;i++) {
		cov += (array1[i]-avg1)*(array2[i]-avg2);
	}
	cov /= array1.length;
	corr = cov/(stdDev1*stdDev2);
	return corr;
}

function getMaxIndex(array) {
	var max = array[0];
	var maxIndex = 0;
	for(var i = 1; i < array.length; i++) {
		if(array[i] > max) {
			maxIndex = i;
			max = array[i];
		}
	}
	return maxIndex;
}

var watcher = chokidar.watch(config.heartratePath, {ignored: /^\./, persistent: true});

watcher.on('add', function(path) {
		var pathSplit = path.split("/");
		var fileName = pathSplit[pathSplit.length-1];
		console.log("fileName: "+fileName);
		if(fileName[0]!="."){
		var audioPath = config.soundPath +fileName.replace(".csv",config.fileFormat);
		console.log("heartrate file detected: "+path);
		console.log("audioPath: "+audioPath);
		var heartrates = new Array();
		var heartratesSorted = new Array();
		var increasingGraph = new Array();
		
		var zcrGraph = new Array();
		var rmsGraph = new Array();
		var energyGraph = new Array();
		var spectralSlopeGraph = new Array();
		var loudnessGraph = new Array();
		var perceptualSpreadGraph = new Array();
		var perceptualSharpnessGraph = new Array();
		var mfccGraph = new Array();
		
		var zcrCorrelations = new Array();
		var rmsCorrelations = new Array();
		var energyCorrelations = new Array();
		var spectralSlopeCorrelations = new Array();
		var loudnessCorrelations = new Array();
		var perceptualSpreadCorrelations = new Array();
		var perceptualSharpnessCorrelations = new Array();
		var mfccCorrelations = new Array();
		
		var zcrGraphSlice = new Array();
		var rmsGraphSlice = new Array();
		var energyGraphSlice = new Array();
		var spectralSlopeGraphSlice = new Array();
		var loudnessGraphSlice = new Array();
		var perceptualSpreadGraphSlice = new Array();
		var perceptualSharpnessGraphSlice = new Array();
		var mfccGraphSlice = new Array();
		
		var zcrPoints = 0;
		var rmsPoints = 0;
		var energyPoints = 0;
		var spectralSlopePoints = 0;
		var loudnessPoints = 0;
		var perceptualSpreadPoints = 0;
		var perceptualSharpnessPoints = 0;
		var mfccPoints = 0;
		
		var datetime = new Date().toISOString().replace(/T/,' ').replace(/\..+/, ' ');
		console.log(datetime);
		//add audio feature extractions here
		//window.AudioContext = window.AudioContext || window.webkitAudioContext;
		//var context = new AudioContext();
		//window.source = context.createMediaElementSource(record);
		//var audioBuffer = config.bufferSize;
		//var context = new AudioContext();
		//var record = new Audio();
		/*
		var meyda = new Meyda({
			"audioContext":context,
			"source":source,
			"bufferSize":audioBuffer,
			"callback":function(features) {
				console.log(features);
				zcrGraph.push(features.zcr);
				rmsGraph.push(features.rms);
				energyGraph.push(features.energy);
				spectralSlopeGraph.push(features.spectralSlope);
				loudnessGraph.push(features.loudness.total);
				perceptualSpreadGraph.push(features.perceptualSpread);
				perceptualSharpnessGraph.push(features.perceptualSharpness);
				mfccGraph.push(features.mfcc);
			}
		});
		
		meyda.start(["zcr","rms","energy","spectralSlope","loudness","perceptualSpread","perceptualSharpness","mfcc"]);
		*/
		csv
			.fromPath(path)
			.on("data", function(data) {
				for(var i = 0; i<data.length;i++) {
					console.log(data[i]+" "+typeof data[i]);
					heartrates.push(parseFloat(data[i]));
					heartratesSorted.push(parseFloat(data[i]));
					console.log(heartrates[i]+" "+typeof heartrates[i]);
				}
			})
			.on("end", function() {
				console.log("heartrates: "+heartrates);
				heartratesSorted.sort();
				heartratesSorted.reverse();
				console.log("sorted heartrates: "+heartratesSorted);
				console.log("heartrates: "+heartrates);
				heartrateAvg = getAvg(heartrates);
				console.log("heartrateAvg: "+heartrateAvg);
				var heartrateThreshold = heartratesSorted[Math.ceil(heartratesSorted.length/10)];
				console.log("heartrateThreshold: "+heartrateThreshold);
				for(var i = 0;i < heartrates.length;i++) {
					if(heartrates[i] >= heartrateThreshold) {
						console.log("evaluated value ("+i+"): "+heartrates[i]);
						while(heartrates[i+1] > heartrates[i]) {
							i++;
						}
						console.log("new value ("+i+"): "+heartrates[i]);
						var j = i;
						while(heartrates[j] > heartrateAvg) {
							console.log("j value ("+j+"): "+heartrates[j]);
							j--;
						}
						increasingGraph = heartrates.slice(j, i+1);
						console.log("increasingGraph: "+increasingGraph);
						//add correlation calcs here
						zcrGraphSlice = zcrGraph.slice(j, i+1);
						rmsGraphSlice = rmsGraph.slice(j, i+1);
						energyGraphSlice = energyGraph.slice(j, i+1);
						spectralSlopeGraphSlice = spectralSlopeGraph.slice(j, i+1);
						loudnessGraphSlice = loudnessGraph.slice(j, i+1);
						perceptualSpreadGraphSlice = perceptualSpreadGraph.slice(j, i+1);
						perceptualSharpnessGraphSlice = perceptualSharpnessGraph.slice(j, i+1);
						mfccGraphSlice = mfccGraph.slice(j, i+1);
						
						zcrCorrelations.push(getCorrelation(increasingGraph, zcrGraphSlice));
						rmsCorrelations.push(getCorrelation(increasingGraph, rmsGraphSlice));
						energyCorrelations.push(getCorrelation(increasingGraph, energyGraphSlice));
						spectralSlopeCorrelations.push(getCorrelation(increasingGraph, spectralSlopeGraphSlice));
						loudnessCorrelations.push(getCorrelation(increasingGraph, loudnessGraphSlice));
						perceptualSpreadCorrelations.push(getCorrelation(increasingGraph, perceptualSpreadGraphSlice));
						perceptualSharpnessCorrelations.push(getCorrelation(increasingGraph, perceptualSharpnessGraphSlice));
						mfccCorrelations.push(getCorrelation(increasingGraph, mfccGraphSlice));
						
						while(heartrates[i] >= heartrateThreshold) {
							i++;
						}
					}
				}
				var output = {
					'timestamp':datetime,
					'zcrCorrelation':null,
					'rmsCorrelation':null,
					'energyCorrelation':null,
					'spectralSlopeCorrelation':null,
					'loudnessCorrelation':null,
					'perceptualSpreadCorrelation':null,
					'perceptualSharpnessCorrelation':null,
					'mfccCorrelation':null,
					'zcrPts':0,
					'rmsPts':0,
					'energyPts':0,
					'spectralSlopePts':0,
					'loudnessPts':0,
					'perceptualSpreadPts':0,
					'perceptualSharpnessPts':0,
					'mfccPts':0
				}
				var zcrCorr = getAvg(zcrCorrelations);
				var rmsCorr = getAvg(rmsCorrelations);
				var energyCorr = getAvg(energyCorrelations);
				var spectralSlopeCorr = getAvg(spectralSlopeCorrelations);
				var loudnessCorr = getAvg(loudnessCorrelations);
				var perceptualSpreadCorr = getAvg(perceptualSpreadCorrelations);
				var perceptualSharpnessCorr = getAvg(perceptualSharpnessCorrelations);
				var mfccCorr = getAvg(mfccCorrelations);
				
				output.zcrCorrelation = zcrCorr;
				output.rmsCorrelation = rmsCorr;
				output.energyCorrelation = energyCorr;
				output.spectralSlopeCorrelation = spectralSlopeCorr;
				output.loudnessCorrelation = loudnessCorr;
				output.perceptualSpreadCorrelation = perceptualSpreadCorr;
				output.perceptualSharpnessCorrelation = perceptualSharpnessCorr;
				output.mfccCorrelation = mfccCorr;
				
				var correlations = [zcrCorr, rmsCorr, energyCorr, spectralSlopeCorr, loudnessCorr, perceptualSpreadCorr, perceptualSharpnessCorr, mfccCorr];
				console.log(correlations);
				for (var i = 3; i <= 1; i--) {
					var maxIndex = getMaxIndex(correlations);
					switch(maxIndex) {
						case 0:
							zcrPoints += i;
							break;
						case 1:
							rmsPoints += i;
							break;
						case 2:
							energyPoints += i;
							break;
						case 3:
							spectralSlopePoints += i;
							break;
						case 4:
							loudnessPoints += i;
							break;
						case 5:
							perceptualSpreadPoints += i;
							break;
						case 6:
							perceptualSharpnessPoints += i;
							break;
						case 7:
							mfccPoints += i;
							break;
					}
					correlations[maxIndex] = -1000;
				}
				output.zcrPts = zcrPoints;
				output.rmsPts = rmsPoints;
				output.energyPts = energyPoints;
				output.spectralSlopePts = spectralSlopePoints;
				output.loudnessPts = loudnessPoints;
				output.perceptualSpreadPts = perceptualSpreadPoints;
				output.perceptualSharpnessPts = perceptualSharpnessPoints;
				output.mfccPts = mfccSlopePoints;
				console.log(output);
				var outputFile = config.outputPath + datetime + '.json';
				jsonfile.writeFile(outputFile, output, function(err) {
					console.error(err);
				});
			})
		}
	});
	
