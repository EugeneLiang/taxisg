/**
 * AWS DynamoDB
 */
AWS.config.update({
  region: 'ap-southeast-1',
  accessKeyId: 'AKIAJEZJR6ZGINIW5YYQ',
  secretAccessKey: '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',
});

const docClient = new AWS.DynamoDB.DocumentClient();

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
        return resolve(data);
      });
    });
  },

  countRange(since = null, to = null) {
    const oldestDays = 60;
    const sinceOldest = moment().subtract(oldestDays, 'days').unix();

    if (!Number.isInteger(since) || since < sinceOldest) {
      since = moment().subtract(30, 'days').unix();
    }

    const params = {
      TableName: this.tables.grains,
      KeyConditionExpression: '#d = :d AND #t >= :t',
      ExpressionAttributeNames: {
        '#d': 'domain',
        '#t': 'timestamp',
        '#c': 'count',
      },
      ExpressionAttributeValues: {
        ':d': 1,
        ':t': since
      },
      ProjectionExpression: '#t, #c',
      Limit: oldestDays * 86400 * 2,
      ScanIndexForward: true,
      ReturnConsumedCapacity: 'TOTAL'
    };

    return this.queryUntilEnd(params);
  },

  locations(timestamp) {
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
        return resolve(data);
      });
    });
  },

  // Query DynamoDB with pagination support
  // NOTE: Only data.Items are handled, the other fields are not handled (summed/concatenated, etc)
  queryUntilEnd(params, lastEvaluatedKey = null) {
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    return new Promise((resolve, reject) => {
      docClient.query(params, (err, data) => {
        if (err) {
          return reject(err);
        }

        if (data.LastEvaluatedKey) {
          this.queryUntilEnd(params, data.LastEvaluatedKey).then(nextData => {
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
          return resolve(data);
        }
      });
    });
  }
}

/**
 * Cache
 */
const cache = {
  snapshotsRange: null,
  earliestTimestamp: null
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
      //option: 'snapshots'
      option: 'animation'
    }
  },

  render() {
    return (
      <div id="app-proper">
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
      earliestTimestamp: moment().subtract(30, 'day').unix()
    }
  },

  componentDidMount() {
    if (!cache.earliestTimestamp) {
      db.earliest().then(data => {
        cache.earliestTimestamp = data.Items[0].timestamp;
        this.setState({
          earliestTimestamp: cache.earliestTimestamp
        });
      });
    } else {
      this.setState({
        earliestTimestamp: cache.earliestTimestamp
      });
    }
  },

  render() {
    return (
      <div>
        <div id="animation-date-selector">
          <h3>Select a date</h3>
          <h4><input type="date" min={ moment(this.state.earliestTimestamp * 1000).format('YYYY-MM-DD') } max={ moment().subtract(1, 'day').format('YYYY-MM-DD') }/></h4>
        </div>
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
  dygraph: null,

  loadData() {
    if (!cache.snapshotsRange) {
      let since = moment().subtract(this.props.daysSince, 'days').unix();
      db.countRange(since).then(data => {
        let graphData = [];
        for (let item of data.Items) {
          if (Number.isInteger(item.count) && item.count > 0) {
            graphData.push([ new Date(item.timestamp * 1000), item.count ]);
          }
        }
        cache.snapshotsRange = graphData;
        this.setState({ data: graphData });
      }, err => {
        console.log(err);
      });
    } else {
      this.setState({ data: cache.snapshotsRange });
    }
  },

  getInitialState() {
    return {
      data: []
    };
  },

  componentDidMount() {
    this.loadData();
  },

  componentDidUpdate() {
    this.dygraph = new Dygraph(
      document.getElementById('graph'),
      this.state.data,
      {
        labels: [ 'Time', 'Taxis' ],
        showRangeSelector: true,
        rollPeriod: 5 * 2, // 5 minutes
        rangeSelectorHeight: 50,
        width: 1200,
        height: 400,
        legend: 'always',
        showRoller: true,
        fillGraph: true,
        dateWindow: [ moment().subtract(5, 'days'), moment() ]
      }
    );
  },

  render() {
    return (
      <div>
        <h2>Total number of taxis for the last {this.props.daysSince} days.</h2>
        <div id="graph">
          Loading graph...
        </div>
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

ReactDOM.render(
  <App />,
  document.getElementById('app')
);

