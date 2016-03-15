/**
 * AWS DynamoDB
 */
AWS.config.update({
  region: 'ap-southeast-1',
  accessKeyId: 'AKIAJEZJR6ZGINIW5YYQ',
  secretAccessKey: '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',
});

const docClient = new AWS.DynamoDB.DocumentClient();

let ddbConsumption = 0;

const db = {
  tables: {
    grains: 'taxisg.grains',
    locations: 'taxisg.locations'
  },

  state: {
    grains: null,
    latestTimestamp: null
  },

  latest() {
    const params = {
      TableName: this.tables.grains,
      KeyConditionExpression: '#d = :d',
      ExpressionAttributeNames: {
        '#d': 'domain',
        '#t': 'timestamp',
        '#c': 'count'
      },
      ExpressionAttributeValues: {
        ':d': 1
      },
      ProjectionExpression: '#t, #c',
      Limit: 1,
      ScanIndexForward: false,
      ReturnConsumedCapacity: 'TOTAL'
    };

    return new Promise((resolve, reject) => {
      docClient.query(params, (err, data) => {
        if (err) {
          return reject(err);
        }
        ddbConsumption += data.ConsumedCapacity.CapacityUnits;
        return resolve(data);
      });
    });
  },

  earliest() {
    const params = {
      TableName: this.tables.grains,
      KeyConditionExpression: '#d = :d',
      ExpressionAttributeNames: {
        '#d': 'domain',
        '#t': 'timestamp',
        '#c': 'count'
      },
      ExpressionAttributeValues: {
        ':d': 1
      },
      ProjectionExpression: '#t, #c',
      Limit: 1,
      ScanIndexForward: true,
      ReturnConsumedCapacity: 'TOTAL'
    };

    return new Promise((resolve, reject) => {
      docClient.query(params, (err, data) => {
        if (err) {
          return reject(err);
        }
        ddbConsumption += data.ConsumedCapacity.CapacityUnits;
        return resolve(data);
      });
    });
  },

  countRange(since = null, to = null, lastEvaluatedKey = null) {
    const oldestDays = 60;
    const sinceOldest = moment().subtract(oldestDays, 'days').unix();

    if (!Number.isInteger(since) || since < sinceOldest) {
      since = moment().subtract(30, 'days').unix();
    }

    const params = {
      TableName: this.tables.grains,
      KeyConditionExpression: '#d = :d AND #t >= :ts',
      ExpressionAttributeNames: {
        '#d': 'domain',
        '#t': 'timestamp',
        '#c': 'count',
      },
      ExpressionAttributeValues: {
        ':d': 1,
        ':ts': since
      },
      ProjectionExpression: '#t, #c',
      ScanIndexForward: true,
      ReturnConsumedCapacity: 'TOTAL'
    };

    if (Number.isInteger(to) && to > since) {
      params.KeyConditionExpression = '#d = :d AND #t BETWEEN :ts AND :tt';
      params.ExpressionAttributeValues[':tt'] = to;
    }

    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    return new Promise((resolve, reject) => {
      docClient.query(params, (err, data) => {
        if (err) {
          return reject(err);
        }

        if (data.LastEvaluatedKey) {
          this.countRange(since, to, data.LastEvaluatedKey).then(nextData => {
            data.Items = data.Items.concat(nextData.Items);
            data.Count += nextData.Count;
            data.scannedCount += nextData.scannedCount;
            if (nextData.ConsumedCapacity) {
              data.ConsumedCapacity.CapacityUnits += nextData.ConsumedCapacity.CapacityUnits;
            }
            return resolve(data);
          }, err => {
            return reject(err);
          });
        } else {
          ddbConsumption += data.ConsumedCapacity.CapacityUnits;
          return resolve(data);
        }
      });
    });
  },

  locations(timestamp) {
    console.log('Loading locations for ' + moment(timestamp * 1000).format());
    const params = {
      TableName: this.tables.locations,
      Key: {
        timestamp
      },
      ReturnConsumedCapacity: 'TOTAL'
    };

    return new Promise((resolve, reject) => {
      docClient.get(params, (err, data) => {
        if (err) {
          return reject(err);
        }
        ddbConsumption += data.ConsumedCapacity.CapacityUnits;
        return resolve(data);
      });
    });
  },

  locationsAcross(timestamps, step = 20) {
    console.log(timestamps.length);
    if (step > 1) {
      timestamps = timestamps.filter(
        (timestamp, i) => {
          return (i % step === 0);
        }
      );
    }
    let locationPromises = timestamps.map(
      (timestamp) => this.locations(timestamp)
    );
    return Promise.all(locationPromises);
  }
}

/**
 * Cache
 */
const cache = {
  snapshotsRange: null,
  earliestTimestamp: null,
  animation: []
};

/**
 * React
 */
const App = React.createClass({
  isActive(name) {
    return this.state.option === name;
  },

  handleClick(name) {
    this.setState({
      option: name
    });
  },

  getInitialState() {
    return {
      option: 'snapshots'
      //option: 'animation',
    }
  },

  render() {
    return (
      <div id="app-proper">
        <DynamoDBStatus ddbConsumption={this.props.ddbConsumption} />
        <div className="text-center">
          <h1>Singapore taxis</h1>
          <div className="btn-group btn-group-lg" role="group">
            <Tab name="snapshots" label="Snapshots" active={this.isActive('snapshots')}
              handleClick={this.handleClick}
            />
            <Tab name="animation" label="Animation" active={this.isActive('animation')}
              handleClick={this.handleClick}
            />
          </div>
        </div>
        <TabContent active={this.state.option} />
      </div>
    );
  }
});

const Tab = React.createClass({
  getClasses() {
    let classes = 'btn btn-default';
    if (this.props.active) {
      classes = classes + ' active';
    }
    return classes;
  },

  handleClick(event) {
    this.props.handleClick(this.props.name);
  },

  render() {
    return <button type="button" className={this.getClasses()} onClick={this.handleClick}>{this.props.label}</button>
  }
});

const TabContent = React.createClass({
  render() {
    if (this.props.active === 'animation') {
      return <Animation />;
    } else {
      return <Snapshots />;
    }
  }
});

const Snapshots = React.createClass({
  render() {
    return (
      <div>
        <Range daysSince="14" />
        <Latest />
      </div>
    );
  }
});

const Animation = React.createClass({
  getInitialState() {
    return {
      rangeAllowed: {
        min: moment().subtract(30, 'day').unix(),
        max: moment().subtract(1, 'day').endOf('day').unix(),
      },
      date: null,
      grains: null,
      locations: null
    }
  },

  componentDidMount() {
    if (!cache.earliestTimestamp) {
      db.earliest().then(data => {
        cache.earliestTimestamp = data.Items[0].timestamp;
        this.setState({
          rangeAllowed: {
            min: moment(cache.earliestTimestamp * 1000).startOf('day').unix(),
            max: moment().subtract(1, 'day').endOf('day').unix(),
          },
        });
      });
    } else {
      this.setState({
        rangeAllowed: {
          min: moment(cache.earliestTimestamp * 1000).startOf('day').unix(),
          max: moment().subtract(1, 'day').endOf('day').unix(),
        },
      });
    }
  },

  handleChange(event) {
    const date = event.target.value;
    const dayStart = moment(event.target.value).startOf('day').unix();
    const dayEnd = moment(event.target.value).endOf('day').unix();

    if (dayStart >= this.state.rangeAllowed.min && dayEnd <= this.state.rangeAllowed.max) {
      db.countRange(dayStart, dayEnd).then(data => {
        this.setState({
          date,
          grains: data.Items
        });

        return db.locationsAcross(data.Items.map(
          (item) => item.timestamp
        ));
      }).then(data => {
        console.log(data);
      });
    }
  },

  render() {
    return (
      <div>
        <div id="animation-date-selector">
          <h2>Select date</h2>
          <h4>
            <input type="date"
              min={moment(this.state.rangeAllowed.min * 1000).format('YYYY-MM-DD')}
              max={moment(this.state.rangeAllowed.max * 1000).format('YYYY-MM-DD')}
              onChange={this.handleChange}
            />
          </h4>
        </div>
        <AnimationLineChart data={this.state.grains} date={this.state.date} />
        <h2>Map with player</h2>
      </div>
    );
  }
});

const AnimationLineChart = React.createClass({
  render() {
    let graph = null;
    if (this.props.data) {
      const options = {
        showRangeSelector: false,
        height: 200,
        dateWindow: [ moment(this.props.data[0].timestamp * 1000).startOf('day'), moment(this.props.data[0].timestamp * 1000).endOf('day') ]
      }

      graph = (
        <div>
          <h2>{ moment(this.props.date, 'YYYY-MM-DD').format('dddd, MMMM Do, YYYY') }</h2>
          <Graph grains={this.props.data} options={options} />
        </div>
      );
    }

    return (
      <div>
      {graph}
      </div>
    );
  }
});

const Latest = React.createClass({
  refreshTimer: null,

  loadFromDb() {
    db.latest().then(data => {
      this.setState({
        timestamp: moment(data.Items[0].timestamp * 1000).format('dddd, MMMM Do YYYY, h:mm:ss a'),
        count: data.Items[0].count.toLocaleString()
      });
      return db.locations(data.Items[0].timestamp);
    }).then(data => {
      this.setState({
        locations: data.Item.locations
      });
    }, err => {
      console.log(err);
    });
  },

  getInitialState() {
    return {
      timestamp: 'loading...',
      count: 'loading...',
      locations: []
    };
  },

  componentDidMount() {
    this.loadFromDb();
    this.refreshTimer = setInterval(this.loadFromDb, 30000);
  },

  componentWillUnmount() {
    clearInterval(this.refreshTimer);
  },

  render() {
    return (
      <div id="latest">
        <h2>Latest</h2>
        <h3>{this.state.count} taxis on the road</h3>
        <p>as at {this.state.timestamp}.</p>
        <MapArea locations={this.state.locations} />
      </div>
    );
  }
});

const Range = React.createClass({
  loadData() {
    if (!cache.snapshotsRange) {
      let since = moment().subtract(this.props.daysSince, 'days').unix();
      db.countRange(since).then(data => {
        cache.snapshotsRange = data;
        this.setState({ data });
      }, err => {
        console.log(err);
      });
    } else {
      this.setState({ data: cache.snapshotsRange });
    }
  },

  getInitialState() {
    return {
      data: null
    };
  },

  componentDidMount() {
    this.loadData();
  },

  render() {
    let graph = null;
    if (this.state.data) {
      const options = {
      };
      graph = <Graph grains={this.state.data.Items} options={options} />;
      console.log(this.state.data);
    }

    return (
      <div>
        <h2>Total number of taxis for the last {this.props.daysSince} days.</h2>
        {graph}
      </div>
    );
  }
});

const MapArea = React.createClass({
  map: null,
  heatmap: null,

  getInitialState() {
    return {
      markers: [],
      heatmapData: new google.maps.MVCArray()
    }
  },

  componentDidMount() {
    let styles = [
      {
        "stylers": [
          { "hue": "#e500ff" },
          { "invert_lightness": true },
          { "saturation": -20 },
          { lightness: -20 }
        ]
      }
    ];

    this.map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 1.35763, lng: 103.816797 },
      zoom: 12,
      minZoom: 12,
      //maxZoom: 16,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: styles
    });

    this.heatmap = new google.maps.visualization.HeatmapLayer({
      data: this.state.heatmapData,
      radius: 15,
      map: this.map
    });
  },

  componentWillUpdate() {
    this.state.heatmapData.clear();
  },

  render() {
    for (let location of this.props.locations) {
      this.state.heatmapData.push(new google.maps.LatLng(location));
    }

    return (
      <div id="map">
        Loading map...
      </div>
    );
  }
});

const Graph = React.createClass({
  getInitialState() {
    return {
      id: 'graph' + Math.floor(Math.random() * 1000000000000).toString(),
      options: {
        labels: [ 'Time', 'Taxis' ],
        showRangeSelector: true,
        rollPeriod: 5 * 2, // 5 minutes
        rangeSelectorHeight: 50,
        width: 1200,
        height: 400,
        legend: 'always',
        showRoller: true,
        fillGraph: true,
        dateWindow: [ moment().subtract(5, 'days'), moment() ],
        clickCallback: (event, date) => {
          console.log(date);
        }
      }
    }
  },

  convertData(grains) {
    if (!grains) {
      return null;
    }

    let graphData = [];
    for (let item of grains) {;
      if (Number.isInteger(item.count) && item.count > 0) {
        graphData.push([ new Date(item.timestamp * 1000), item.count ]);
      }
    }
    return graphData;
  },

  componentDidMount() {
    this.renderGraph();
  },
  componentDidUpdate() {
    this.renderGraph();
  },

  renderGraph() {
    let options = this.state.options;
    for (let option in this.props.options) {
      this.state.options[option] = this.props.options[option];
    }
    this.dygraph = new Dygraph(
      document.getElementById(this.state.id),
      this.convertData(this.props.grains),
      this.state.options
    );
  },

  render() {
    return (
      <div id={this.state.id}>
        Loading graph...
      </div>
    );
  }
});

const DynamoDBStatus = React.createClass({
  getInitialState() {
    return {
      ddbConsumption
    }
  },

  componentDidMount() {
    setInterval(() => {
      if (ddbConsumption !== this.state.ddbConsumption) {
        console.log('poll');
        this.setState({
          ddbConsumption
        });
      }
    }, 200);
  },

  render() {
    return (
      <div className="dynamodb-status">
        Total consumed DynamoDB capacity units: {this.state.ddbConsumption}
      </div>
    );
  }
});

ReactDOM.render(
  <App />,
  document.getElementById('app')
);

